import argparse
import sys
import firebase_admin
from firebase_admin import auth, credentials

def init_firebase():
    if not firebase_admin._apps:
        import os
        # firebase-key.json lives one level up from backend/
        key_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "firebase-key.json")
        )
        if os.path.exists(key_path):
            cred = credentials.Certificate(key_path)
            firebase_admin.initialize_app(cred)
        else:
            print(f"Error: firebase-key.json not found at {key_path}")
            print("Ensure the service account key is at the project root.")
            sys.exit(1)

def create_admin(email, password):
    try:
        user = auth.create_user(
            email=email,
            password=password,
            display_name="Admin"
        )
        # Set custom claims for platform admin
        auth.set_custom_user_claims(user.uid, {"site_ids": ["*"]})
        print(f"Successfully created admin user: {email}")
        print(f"UID: {user.uid}")
    except Exception as e:
        if "EMAIL_EXISTS" in str(e) or "already exists" in str(e).lower():
            try:
                user = auth.get_user_by_email(email)
                auth.update_user(user.uid, password=password, display_name=user.display_name or "Admin")
                auth.set_custom_user_claims(user.uid, {"site_ids": ["*"]})
                print(f"User already existed; updated password and promoted to super-admin: {email}")
                print(f"UID: {user.uid}")
                print("Sign out and sign back in so Firebase issues a token with the new claims.")
                return
            except Exception as promote_error:
                print(f"Error promoting existing user: {promote_error}")
                return
        print(f"Error creating user: {e}")

def promote_admin(email):
    try:
        user = auth.get_user_by_email(email)
        claims = dict(user.custom_claims or {})
        claims["site_ids"] = ["*"]
        auth.set_custom_user_claims(user.uid, claims)
        print(f"Successfully promoted user to super-admin: {email}")
        print(f"UID: {user.uid}")
        print("Sign out and sign back in so Firebase issues a token with the new claims.")
    except Exception as e:
        print(f"Error promoting user: {e}")

def show_user(email):
    try:
        user = auth.get_user_by_email(email)
        print(f"Email: {user.email}")
        print(f"UID: {user.uid}")
        print(f"Disabled: {user.disabled}")
        print(f"Custom claims: {user.custom_claims or {}}")
    except Exception as e:
        print(f"Error loading user: {e}")

def delete_admin(email):
    try:
        user = auth.get_user_by_email(email)
        auth.delete_user(user.uid)
        print(f"Successfully deleted user: {email}")
    except Exception as e:
        print(f"Error deleting user: {e}")

def change_password(email, new_password):
    try:
        user = auth.get_user_by_email(email)
        auth.update_user(user.uid, password=new_password)
        print(f"Successfully updated password for: {email}")
    except Exception as e:
        print(f"Error updating password: {e}")

def main():
    parser = argparse.ArgumentParser(description="Manage Chatbot Platform Admins")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Create command
    create_parser = subparsers.add_parser("create", help="Create a new admin")
    create_parser.add_argument("email", help="Admin email")
    create_parser.add_argument("password", help="Admin password")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete an admin")
    delete_parser.add_argument("email", help="Admin email")

    # Password command
    passwd_parser = subparsers.add_parser("passwd", help="Change admin password")
    passwd_parser.add_argument("email", help="Admin email")
    passwd_parser.add_argument("password", help="New password")

    promote_parser = subparsers.add_parser("promote", help="Promote an existing user to super-admin")
    promote_parser.add_argument("email", help="Admin email")

    show_parser = subparsers.add_parser("show", help="Show a user's Firebase custom claims")
    show_parser.add_argument("email", help="Admin email")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    init_firebase()

    if args.command == "create":
        create_admin(args.email, args.password)
    elif args.command == "delete":
        delete_admin(args.email)
    elif args.command == "passwd":
        change_password(args.email, args.password)
    elif args.command == "promote":
        promote_admin(args.email)
    elif args.command == "show":
        show_user(args.email)

if __name__ == "__main__":
    main()


'''
# Create a new super-admin (automatically gets site_ids=["*"])
python backend/create_admin.py create admin@example.com yourpassword

# Update an admin's password
python backend/create_admin.py passwd admin@example.com newpassword

# Promote an existing Firebase user to super-admin
python backend/create_admin.py promote admin@example.com

# Check a user's custom claims
python backend/create_admin.py show admin@example.com

# Delete an admin account
python backend/create_admin.py delete admin@example.com
'''
