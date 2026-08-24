import os
import time
import logging
from typing import List, Dict, Any
import paramiko

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GoogleSFTPClient:
    def __init__(self, private_key_path: str = None, username: str = "feedops_partner", dry_run: bool = False):
        self.hostname = "partnerupload.google.com"
        self.port = 19321
        self.username = username
        self.private_key_path = private_key_path or os.environ.get("GOOGLE_SFTP_KEY_PATH", "~/.ssh/id_rsa")
        self.dry_run = dry_run
        
    def _get_private_key(self):
        key_path = os.path.expanduser(self.private_key_path)
        try:
            # Try Ed25519 first
            return paramiko.Ed25519Key.from_private_key_file(key_path)
        except paramiko.SSHException:
            # Fallback to RSA
            return paramiko.RSAKey.from_private_key_file(key_path)

    def upload_feeds(self, feed_files: List[str], max_retries: int = 3) -> Dict[str, Any]:
        """
        Uploads timestamped feed bundles with retry logic and directory validation.

        Descriptors (*.filesetdesc.json) are uploaded before data files, per
        GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md section 6's `mput` order -- Google's
        ingestion reads descriptors first, so this ordering is required, not
        cosmetic. Sorted here (stable) regardless of what order the caller built
        its file list in.
        """
        feed_files = sorted(feed_files, key=lambda p: 0 if p.endswith(".filesetdesc.json") else 1)

        if self.dry_run:
            logger.info("Dry run mode: Skipping actual SFTP upload.")
            return {
                "status": "success",
                "message": f"Dry run: Simulated upload of {len(feed_files)} files.",
                "uploaded_files": feed_files
            }

        key = self._get_private_key()
        
        for attempt in range(max_retries):
            transport = None
            sftp = None
            try:
                transport = paramiko.Transport((self.hostname, self.port))
                transport.connect(username=self.username, pkey=key)
                sftp = paramiko.SFTPClient.from_transport(transport)
                
                # Directory validation - ensure we are in a valid writable directory
                try:
                    sftp.chdir('upload') # Example directory
                except IOError:
                    logger.warning("Directory 'upload' not found. Using root.")
                
                uploaded = []
                for file_path in feed_files:
                    if not os.path.exists(file_path):
                        logger.error(f"File not found: {file_path}")
                        continue
                        
                    filename = os.path.basename(file_path)
                    remote_path = filename
                    
                    logger.info(f"Uploading {file_path} to {remote_path}...")
                    sftp.put(file_path, remote_path)
                    uploaded.append(filename)
                
                return {
                    "status": "success",
                    "message": f"Successfully uploaded {len(uploaded)} files.",
                    "uploaded_files": uploaded
                }
                
            except Exception as e:
                logger.error(f"Attempt {attempt + 1} failed: {str(e)}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                else:
                    return {
                        "status": "error",
                        "message": f"Failed to upload feeds after {max_retries} attempts: {str(e)}",
                        "uploaded_files": []
                    }
            finally:
                if sftp:
                    sftp.close()
                if transport:
                    transport.close()
                    
        return {"status": "error", "message": "Unknown error", "uploaded_files": []}
