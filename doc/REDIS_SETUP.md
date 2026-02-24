# Redis Setup Guide

This project uses Redis to track active browser tabs and instances. This guide provides instructions for installing and starting Redis on Windows.

## 🛠️ Required Installation (Windows)

### Option 1: Memurai (Native Windows) - Recommended
Memurai is a 100% Redis-compatible cache and datastore for Windows.

1.  **Install via Terminal (Admin):**
    ```powershell
    winget install Memurai.MemuraiDeveloper
    ```
2.  **Verify Service:**
    - Open "Services" (services.msc)
    - Ensure "Memurai" is running.
3.  **Start Client:**
    - Open terminal and type `memurai-cli` to interact with the database.

### Option 2: WSL2 (Linux Subsystem)
1.  **Install WSL:** `wsl --install`
2.  **Install Redis in Ubuntu:**
    ```bash
    sudo apt update
    sudo apt install redis-server
    ```
3.  **Start Redis:** `sudo service redis-server start`

---

## 🔌 Code Integration

The Redis connection is managed in:
- `backend/utils/redis.js`

### Default Configuration:
- **Host:** `127.0.0.1`
- **Port:** `6379`

### Usage:
The application uses Redis to manage:
- `active_tabs`: Count of currently open scraping tabs.
- `active_browsers`: Count of active browser instances.

### Connection Check:
When the backend starts, it will log:
```
✅ Redis connected
```
or
```
❌ Redis error: ...
```
(Note: The backend will still run even if Redis is unavailable, but session tracking will be disabled.)
