import uvicorn
import os
import sys

def main():
    print("========================================")
    print("  Starting FeedOps AI Backend Server    ")
    print("========================================")
    print("\nEnsure you have your environment set up (e.g., FastAPI, Uvicorn installed).")
    print("\nOnce the server is running, open a new terminal and start the Vite frontend:")
    print("  cd frontend")
    print("  npm run dev")
    print("\n========================================\n")
    
    # Add the current directory to sys.path so 'backend' can be resolved
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    uvicorn.run("backend.server.app:app", host="0.0.0.0", port=8000, reload=True)

if __name__ == "__main__":
    main()
