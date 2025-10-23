# Debug Logs Directory

This directory contains debug logs from the frontend.

- Each user session gets a unique log file
- Format: `debug_session_[timestamp]_[random].log`
- Logs are automatically deleted on logout
- Old logs (>7 days) are cleaned up automatically

**Note:** This directory is excluded from git (.gitignore).
