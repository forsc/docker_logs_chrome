# Docker Monitor Chrome Extension

A Chrome extension for monitoring Docker containers, their logs, system usage, and health status. Get real-time updates and notifications about your Docker containers directly in your browser. THIS IS DUE HOW HORRIBLE DOCKER LOGS READING IS! :( 

## Features

- Real-time monitoring of Docker containers
- Container logs viewing and searching
- System metrics monitoring (CPU, Memory, Network, Disk I/O)
- Container health status monitoring
- Error notifications
- Modern and intuitive UI

## Prerequisites

- Docker Desktop for Windows (or Docker daemon for Linux)
- Chrome browser

## Setup

### Windows Docker Desktop Configuration

1. Right-click on the Docker Desktop icon in the system tray
2. Select "Settings"
3. Click on "General" in the left sidebar
4. Check the option "Expose daemon on tcp://localhost:2375 without TLS"
5. Click "Apply & Restart"
6. Wait for Docker Desktop to restart completely

Note: If Docker Desktop fails to start after this change:
1. Right-click Docker Desktop icon and select "Quit Docker Desktop"
2. Open Task Manager and end any remaining Docker processes
3. Start Docker Desktop again

### Linux Docker API Configuration

If you're using Linux, edit or create `/etc/docker/daemon.json`:
```json
{
  "hosts": ["unix:///var/run/docker.sock", "tcp://localhost:2375"]
}
```

Then restart the Docker daemon:
```bash
sudo systemctl restart docker
```

### Chrome Extension Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select the extension directory
4. The Docker Monitor icon should appear in your Chrome toolbar

## Usage

1. Click the Docker Monitor icon in your Chrome toolbar to open the dashboard
2. View all running containers and their current status
3. Select a container to view its logs
4. Use the search function to find specific log entries
5. Monitor system metrics in real-time
6. Receive notifications for container errors or health status changes

## Troubleshooting

### Windows-specific Issues

1. If Docker Desktop won't start:
   - Open Windows PowerShell as Administrator
   - Run: `net stop com.docker.service`
   - Start Docker Desktop again

2. If you can't connect to the API:
   - Make sure Docker Desktop is fully started (check the whale icon in taskbar)
   - Try running this in PowerShell to test the connection:
     ```powershell
     Invoke-RestMethod -Uri 'http://localhost:2375/version'
     ```
   - Check Windows Defender Firewall settings
   - Temporarily disable antivirus to test if it's blocking the connection

3. Common fixes:
   - Restart Docker Desktop
   - Clear Docker Desktop settings and reset to factory defaults
   - Reinstall Docker Desktop if persistent issues occur

### Linux-specific Issues

1. Check Docker daemon status:
   ```bash
   sudo systemctl status docker
   ```

2. Test API connection:
   ```bash
   curl http://localhost:2375/version
   ```

3. Check firewall settings:
   ```bash
   sudo ufw status
   ```

## Security Considerations

- The extension connects only to the local Docker API
- Make sure your Docker API is properly secured
- Do not expose Docker API to the network without proper security measures
- Consider using HTTPS and authentication for production environments

## License

MIT License 
