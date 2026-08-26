import os
import sys
from pathlib import Path

# Load environment variables from .env.localhost
def load_env():
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    env_path = project_root / '.env.localhost'
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ[key.strip()] = val.strip()

load_env()

# Append project root and desktop-app directories to sys.path to allow imports
project_root = Path(__file__).resolve().parent.parent.parent.parent
desktop_app_dir = project_root / 'desktop-app'

if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))
if str(desktop_app_dir) not in sys.path:
    sys.path.insert(0, str(desktop_app_dir))

from server import app, get_ctx
from routes.users_routes import _delete_hosted_account_related_data

def main():
    target_name = sys.argv[1] if len(sys.argv) > 1 else "AuditUser"
    target_email = sys.argv[2] if len(sys.argv) > 2 else "audit_user@localhost.test"
    
    with app.app_context():
        ctx = get_ctx()
        user_service = ctx.user_service
        
        # Search for user by name or email
        target_user = None
        for user in user_service.get_all_users():
            if (user.name == target_name or 
                getattr(user, 'email', '') == target_email or 
                getattr(user, 'login', '') == 'audit_user'):
                target_user = user
                break
                
        if target_user:
            user_id = target_user.user_id
            print(f"[clean_user.py] Found user: {target_user.name} (ID: {user_id}), deleting related data...")
            
            try:
                # Wipes workspace content, database records, and avatar files
                _delete_hosted_account_related_data(ctx, target_user)
            except Exception as e:
                print(f"[clean_user.py] Warning: failed to delete related data: {e}")
                
            # Wipes main user profile from service
            success = user_service.delete_user(user_id)
            if success:
                print(f"[clean_user.py] User {user_id} deleted successfully.")
            else:
                print(f"[clean_user.py] Failed to delete user profile {user_id}.")
        else:
            print("[clean_user.py] No audit user found in database.")

if __name__ == "__main__":
    main()
