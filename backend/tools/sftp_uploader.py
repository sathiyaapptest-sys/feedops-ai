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
        Google's Generic SFTP reference ("The descriptor file should be uploaded
        before the feed contents"). Sorted here (stable) regardless of what
        order the caller built its file list in.

        Uploads FLAT into upload/ (the dropbox root) -- NOT a per-run
        subdirectory. Confirmed against Google's real Generic SFTP reference
        (developers.google.com/.../reference/menu-feeds/generic-sftp): the
        descriptor's data_file field holds "Paths (relative to the dropbox
        root) specifying data files included in this feed", and "The file
        names and path locations ... must exactly match what was included
        within the data_file field. If any file is ... uploaded to a
        different location then the entire feed will not be processed."
        feed_compiler.py's data_file entries are bare filenames (no
        directory prefix), which are only correct if the data file actually
        lands in the dropbox root beside the descriptor -- a prior version of
        this method nested files into upload/<timestamp>/ instead (based on
        an internal doc that turned out not to match Google's real reference
        here), which put the real file at a path the descriptor's bare
        filename didn't resolve to. Confirmed live: that mismatch is exactly
        what produced "Waiting for remaining shards" with 0 items processed,
        even after the descriptor's own JSON was fully valid ("No issues
        found for this ingestion").
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

                try:
                    sftp.chdir('upload')
                except IOError:
                    logger.warning("Directory 'upload' not found. Using root.")

                uploaded = []
                for file_path in feed_files:
                    if not os.path.exists(file_path):
                        logger.error(f"File not found: {file_path}")
                        continue

                    filename = os.path.basename(file_path)

                    logger.info(f"Uploading {file_path} to upload/{filename}...")
                    sftp.put(file_path, filename)
                    uploaded.append(filename)

                return {
                    "status": "success",
                    "message": f"Successfully uploaded {len(uploaded)} files to upload/.",
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
