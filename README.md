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

- Docker daemon running on your system
- Chrome browser

## Setup

### Docker API Configuration

1. Configure Docker to expose its API:

   Edit or create `/etc/docker/daemon.json`:
   ```json
   {
     "builder": {
       "gc": {
         "defaultKeepStorage": "20GB",
         "enabled": true
       }
     },
     "experimental": false,
     "features": {
       "buildkit": true
     },
     "expose-api": true,
     "hosts": [
       "tcp://localhost:2375",
       "npipe:////.//pipe//docker_engine"
     ]
   }
   ```

2. Restart Docker daemon:
   ```bash
   sudo systemctl restart docker
   ```

   Note: Make sure to secure your Docker API if the machine is accessible from the network.

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

## Extension Structure

- `manifest.json` - Extension configuration
- `popup.html` - Main UI
- `popup.js` - UI logic
- `background.js` - Background processes and Docker API communication
- `styles.css` - Styling

## Security Considerations

- The extension connects only to the local Docker API
- Make sure your Docker API is properly secured
- Do not expose Docker API to the network without proper security measures
- Consider using HTTPS and authentication for production environments

## Troubleshooting

- Ensure Docker daemon is running and the API is exposed
- Check that port 2375 is accessible locally
- Verify Chrome extension permissions
- Check Chrome DevTools console for errors
- Make sure your Docker daemon configuration is correct

## License

MIT License 
