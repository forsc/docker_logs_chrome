# Docker Container Monitor Chrome Extension

A Chrome extension to monitor Docker containers running on your system. This extension connects directly to the Docker API to provide real-time information about your containers.

## Features

- **Container Overview**: View all running containers at a glance
- **Detailed Metrics**: Monitor CPU, memory, network, and disk usage for each container
- **Searchable Logs**: View and search container logs
- **Alerts**: Receive notifications when containers fail or stop unexpectedly
- **Draggable UI**: Move the extension window around while browsing

## Installation

### Prerequisites

- Docker must be running on your system
- Docker API must be exposed on port 2375 (see setup instructions below)
- Google Chrome browser

### Installing the Extension

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the directory containing this extension
5. The Docker Container Monitor extension should now appear in your Chrome toolbar

### Configuring Docker to Expose the API

For the extension to work, you need to configure Docker to expose its API on port 2375. This can be done as follows:

#### Windows (Docker Desktop)

1. Right-click the Docker icon in the system tray and select "Settings"
2. Go to "Docker Engine" tab
3. Add the following to the JSON configuration:
   ```json
   {
     "hosts": ["tcp://0.0.0.0:2375", "npipe://"],
     "experimental": true
   }
   ```
4. Click "Apply & Restart"

**IMPORTANT SECURITY NOTE**: Exposing the Docker API without TLS encryption is not recommended for production environments. This extension is intended for local development and monitoring only.

## Usage

1. Click the Docker Container Monitor icon in your Chrome toolbar to open the extension
2. The main view shows all containers with basic information
3. Click on a container to view detailed information, metrics, and logs
4. Use the search box to filter container logs
5. Drag the header to move the extension window around

## Features in Detail

### Container Overview

The main view displays all containers with their:
- Name
- Status (running, stopped, etc.)
- Image
- Basic CPU and memory usage

### Container Details

Click on a container to view:
- **Metrics**: Real-time CPU, memory, network, and disk usage
- **Logs**: Container logs with search functionality
- **Info**: Detailed container information including environment variables, ports, and volumes

### Alerts

The extension monitors containers in the background and sends alerts when:
- A container stops unexpectedly
- A container crashes with a non-zero exit code
- A container is restarting repeatedly

### Draggable UI

The extension window can be moved around by dragging the header, allowing you to position it anywhere on the screen while browsing.

## Troubleshooting

- **Can't connect to Docker API**: Make sure Docker is running and the API is exposed on port 2375
- **No containers showing**: Check if you have any containers running with `docker ps`
- **Extension not updating**: Try refreshing the extension by clicking the refresh button

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Docker for providing the API
- Chrome Extensions API documentation 