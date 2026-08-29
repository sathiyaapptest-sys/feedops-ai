import firebase_admin
from firebase_admin import credentials, auth
from fastapi import Request, HTTPException, status, Depends
import os

# Initialize Firebase Admin
PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", os.getenv("GCP_PROJECT", "gen-lang-client-0724450224"))
if not firebase_admin._apps:
    try:
        firebase_admin.initialize_app(options={"projectId": PROJECT_ID})
    except Exception as e:
        print(f"Failed to initialize Firebase Admin: {e}")

async def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header"
        )
    
    token = auth_header.split(" ")[1]
    
    try:
        decoded_token = auth.verify_id_token(token)
        # You could also fetch user role from Firestore here if needed using admin SDK
        return decoded_token
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication credentials: {str(e)}"
        )
