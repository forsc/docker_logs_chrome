# Docker Monitor Chrome Extension

A Chrome extension for monitoring Docker containers, their logs, system usage, and health status. Get real-time updates and notifications about your Docker containers directly in your browser. THIS IS DUE HOW HORRIBLE DOCKER LOGS READING IS! :( 

## Features

- Real-time monitoring of Docker containers
- Container logs viewing and searching
- System metrics monitoring (CPU, Memory, Network, Disk I/O)
- Container health status monitoring
- Error notifications
- Modern and intuitive UI
- Cross-platform support (Linux and Windows)

## Prerequisites

- Docker (Docker Desktop for Windows or Docker Engine for Linux)
- Chrome browser (version 88 or later)

## Setup

### Linux Setup

1. **Docker Socket Method (Recommended)**
   ```bash
   # Give permission to Docker socket
   sudo chmod 666 /var/run/docker.sock
   ```
   This is the default and most secure method. No additional configuration needed.

2. **TCP Method (Optional, if socket method doesn't work)**
   
   Edit `/etc/docker/daemon.json`:
   ```json
   {
     "hosts": [
       "unix:///var/run/docker.sock",
       "tcp://localhost:2375"
     ]
   }
   ```

   Then restart Docker:
   ```bash
   sudo systemctl restart docker
   ```

3. **Verify Setup**
   ```bash
   # Test socket connection
   curl --unix-socket /var/run/docker.sock http://localhost/version
   
   # If using TCP, also test
   curl http://localhost:2375/version
   ```

### Windows Setup

1. **Docker Desktop Configuration**
   - Right-click Docker Desktop icon in system tray
   - Click "Settings"
   - Go to "General" settings
   - Enable "Expose daemon on tcp://localhost:2375 without TLS"
   - Click "Apply & Restart"

2. **Verify Setup**
   
   Open PowerShell and run:
   ```powershell
   Invoke-RestMethod -Uri 'http://localhost:2375/version'
   ```

3. **If Docker Desktop Fails to Start**
   ```powershell
   # Stop Docker service
   net stop com.docker.service
   
   # Start Docker Desktop again
   ```

### Chrome Extension Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The Docker Monitor icon should appear in your Chrome toolbar

## Usage

1. Click the Docker Monitor icon in your Chrome toolbar
2. The dashboard will show all your containers with their status
3. Select any container to:
   - View its logs in real-time
   - Search through logs
   - Monitor system metrics
   - Check health status
4. Get notifications when:
   - Containers stop unexpectedly
   - Health checks fail
   - Resource usage exceeds thresholds

## Troubleshooting

### Linux Issues

1. **Permission Denied**
   ```bash
   # Check Docker socket permissions
   ls -l /var/run/docker.sock
   
   # Fix permissions
   sudo chmod 666 /var/run/docker.sock
   ```

2. **Connection Refused**
   ```bash
   # Check Docker service status
   sudo systemctl status docker
   
   # Restart Docker service
   sudo systemctl restart docker
   ```

3. **Firewall Issues**
   ```bash
   # Check if port is blocked (if using TCP)
   sudo netstat -tuln | grep 2375
   
   # Allow port in firewall
   sudo ufw allow 2375/tcp
   ```

### Windows Issues

1. **Docker Desktop Won't Start**
   - Open Task Manager
   - End all Docker-related processes
   - Restart Docker Desktop

2. **Connection Issues**
   - Check Windows Defender Firewall settings
   - Add Docker.exe to firewall exceptions
   - Temporarily disable antivirus to test

3. **Reset Docker Desktop**
   - Right-click Docker Desktop icon
   - Select "Troubleshoot"
   - Click "Clean / Purge data"
   - Reset Docker Desktop to factory settings

### Common Issues

1. **Extension Can't Connect**
   - Check Chrome console for error messages
   - Verify Docker is running
   - Try both socket and TCP connections
   - Check if running in correct network context

2. **Performance Issues**
   - Reduce log tail size in settings
   - Adjust refresh interval
   - Clear extension cache

3. **Missing Containers**
   - Verify user has permission to access Docker
   - Check Docker context is correct
   - Ensure containers are in the same network

## Security Notes

- The Unix socket method is more secure than TCP
- TCP connection is unencrypted - use only for development
- Don't expose Docker API to public networks
- Consider using TLS for production environments
- Regularly update Docker and the extension

## Development

Want to contribute? Great! Please check our contribution guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - feel free to use and modify as needed! 
