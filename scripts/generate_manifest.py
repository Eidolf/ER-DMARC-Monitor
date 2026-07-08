#!/usr/bin/env python3
import os
import ast
import re
import json

def parse_db_models():
    models_path = "api/models.py"
    if not os.path.exists(models_path):
        return {}
    
    with open(models_path, "r") as f:
        tree = ast.parse(f.read())
        
    models = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            # Check if it has SQLModel as a base class
            base_names = [base.id for base in node.bases if isinstance(base, ast.Name)]
            if "SQLModel" in base_names or any("SQLModel" in name for name in base_names):
                model_name = node.name
                fields = {}
                relationships = []
                
                for body_node in node.body:
                    if isinstance(body_node, ast.AnnAssign) and isinstance(body_node.target, ast.Name):
                        field_name = body_node.target.id
                        # Get field type
                        field_type = "unknown"
                        if isinstance(body_node.annotation, ast.Name):
                            field_type = body_node.annotation.id
                        elif isinstance(body_node.annotation, ast.Subscript):
                            # Handle things like list[ReportRecord] or int | None
                            field_type = ast.unparse(body_node.annotation)
                        elif isinstance(body_node.annotation, ast.BinOp):
                            field_type = ast.unparse(body_node.annotation)
                        
                        fields[field_name] = field_type
                        
                        # Check if it's a relationship
                        if body_node.value and isinstance(body_node.value, ast.Call):
                            func_name = ast.unparse(body_node.value.func)
                            if "Relationship" in func_name or "relationship" in func_name:
                                # Find referenced model
                                rel_model = "unknown"
                                for arg in body_node.value.keywords:
                                    if arg.arg == "sa_relationship" and isinstance(arg.value, ast.Call):
                                        for subarg in arg.value.args:
                                            if isinstance(subarg, ast.Constant):
                                                rel_model = subarg.value
                                if rel_model == "unknown" and "list[" in field_type:
                                    # Infer from list type
                                    rel_model = field_type.split("[")[1].split("]")[0]
                                relationships.append(rel_model)
                                
                models[model_name] = {
                    "file": models_path,
                    "fields": fields,
                    "relationships": relationships
                }
    return models

def parse_endpoints():
    main_path = "api/main.py"
    if not os.path.exists(main_path):
        return []
        
    with open(main_path, "r") as f:
        tree = ast.parse(f.read())
        
    endpoints = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                    # Check for FastAPI decorators like @app.get, @app.post, etc.
                    obj = ast.unparse(dec.func.value)
                    if obj == "app":
                        method = dec.func.attr.upper()
                        path = ""
                        if dec.args:
                            path = ast.unparse(dec.args[0]).strip("'\"")
                        
                        summary = node.name.replace("_", " ").capitalize()
                        description = ast.get_docstring(node) or ""
                        
                        req_model = None
                        for arg in node.args.args:
                            if arg.annotation and arg.arg not in ("session", "user", "request", "call_next"):
                                req_model = ast.unparse(arg.annotation)
                                
                        endpoints.append({
                            "path": path,
                            "method": method,
                            "summary": summary,
                            "description": description.strip(),
                            "request_model": req_model,
                            "response_model": ast.unparse(node.returns) if node.returns else None,
                            "file": main_path
                        })
    return endpoints

def parse_services():
    services = {}
    service_files = {
        "dns_utils.py": "api/dns_utils.py",
        "ip_utils.py": "api/ip_utils.py",
        "entra.py": "api/entra.py",
        "auth.py": "api/auth.py"
    }
    
    for service_name, rel_path in service_files.items():
        if os.path.exists(rel_path):
            with open(rel_path, "r") as f:
                tree = ast.parse(f.read())
            
            methods = []
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                    methods.append({
                        "name": node.name,
                        "signature": f"def {node.name}({', '.join(arg.arg for arg in node.args.args)})",
                        "description": (ast.get_docstring(node) or "").strip()
                    })
            
            services[service_name.replace(".py", "Utils")] = {
                "file": rel_path,
                "methods": methods
            }
    return services

def scan_frontend():
    components = {}
    hooks = {}
    routes = {
        "/": "Dashboard (Requires authentication)",
        "/login": "Login Page",
        "/settings": "SettingsView (Admin only)"
    }
    
    src_dir = "frontend/src"
    if os.path.exists(src_dir):
        for root, _, files in os.walk(src_dir):
            for file in files:
                rel_file = os.path.join(root, file)
                if file.endswith(".tsx") or file.endswith(".jsx"):
                    comp_name = file.split(".")[0]
                    # Heuristically describe
                    desc = f"UI component in {file}"
                    if comp_name == "App":
                        desc = "Main application container and route controller"
                    elif comp_name == "Login":
                        desc = "Login view allowing Local and SSO (Entra ID) authentication"
                    elif comp_name == "MFA":
                        desc = "Multi-Factor Authentication prompt and TOTP validation form"
                    elif comp_name == "Settings":
                        desc = "System Settings interface for branding, MFA enforcement, SSO, and SMTP configurations"
                    elif comp_name == "AuthContext":
                        desc = "Authentication Provider context for managing session state, login/logout actions"
                        
                    components[comp_name] = {
                        "file": rel_file,
                        "description": desc
                    }
                elif file.endswith(".ts") or file.endswith(".js"):
                    if file.startswith("use"):
                        hook_name = file.split(".")[0]
                        hooks[hook_name] = {
                            "file": rel_file,
                            "description": f"Custom hook for {hook_name} logic"
                        }
                        
    # Context also acts as a hook
    if "AuthContext" in components:
        hooks["useAuth"] = {
            "file": "frontend/src/AuthContext.tsx",
            "description": "Hook to access authentication status, user information, and authentication functions"
        }
        
    return {
        "components": components,
        "hooks": hooks,
        "routes": routes
    }

def main():
    db_models = parse_db_models()
    endpoints = parse_endpoints()
    services = parse_services()
    frontend = scan_frontend()
    
    manifest = {
        "metadata": {
            "name": "ER-DMARC-Monitor",
            "description": "Comprehensive, scalable DMARC RUA/RUF report monitoring and compliance system",
            "entry_points": {
                "backend": "api/main.py",
                "frontend": "frontend/src/main.tsx"
            }
        },
        "file_tree": {
            "api": "FastAPI backend exposing REST endpoints for dashboard, admin settings, and user auth",
            "dmarc-parser": "Asynchronous worker that parses XML reports from raw payloads into the PostgreSQL database",
            "smtp-ingester": "SMTP listener receiving DMARC XML/GZ/ZIP reports and writing to the queue volume",
            "frontend": "Vite + React + TypeScript frontend dashboard displaying authentication compliance stats",
            "scripts": "Setup scripts, developer utilities, and SMTP test tools"
        },
        "db_models": db_models,
        "services": services,
        "endpoints": endpoints,
        "frontend": frontend
    }
    
    target_path = "project_manifest.json"
    
    # Exclude dynamic timestamps from diff, compare exact content
    new_content = json.dumps(manifest, indent=2)
    
    should_write = True
    if os.path.exists(target_path):
        with open(target_path, "r") as f:
            try:
                old_manifest = json.load(f)
                # Compare without potential noise
                if old_manifest == manifest:
                    should_write = False
            except Exception:
                pass
                
    if should_write:
        with open(target_path, "w") as f:
            f.write(new_content)
        print("✅ project_manifest.json generated/updated successfully.")
    else:
        print("ℹ️ project_manifest.json is already up to date. No changes made.")

if __name__ == "__main__":
    main()
