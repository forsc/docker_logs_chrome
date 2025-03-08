// Docker API endpoints in order of preference
const DOCKER_API_ENDPOINTS = [
    'unix:///var/run/docker.sock',  // Linux default socket
    'http://localhost:2375',        // TCP fallback
    'http://127.0.0.1:2375'         // TCP fallback alternative
];

let ACTIVE_DOCKER_API = null;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;

// Helper function to handle Unix socket requests
async function unixSocketFetch(path, options = {}) {
    try {
        console.log('Attempting Unix socket connection...', path);
        // Try Unix socket first (for Linux)
        const response = await fetch(`http://unix:/var/run/docker.sock:${path}`, {
            ...options,
            headers: {
                ...options.headers,
                'Host': 'localhost'
            }
        });
        console.log('Unix socket response:', response.status, response.statusText);
        return response;
    } catch (error) {
        console.error('Unix socket connection failed:', error.message);
        throw error;
    }
}

// Helper function to make Docker API requests
async function dockerFetch(path, options = {}) {
    if (!ACTIVE_DOCKER_API) {
        console.log('No active Docker API, attempting to find endpoint...');
        await findActiveDockerEndpoint();
        if (!ACTIVE_DOCKER_API) {
            throw new Error('No active Docker API endpoint');
        }
    }

    try {
        console.log(`Making request to ${ACTIVE_DOCKER_API}${path}`);
        
        // Add proper headers for Docker API
        const defaultHeaders = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        const finalOptions = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers
            }
        };

        if (ACTIVE_DOCKER_API.startsWith('unix://')) {
            return await unixSocketFetch(path, finalOptions);
        } else {
            const response = await fetch(`${ACTIVE_DOCKER_API}${path}`, finalOptions);
            console.log('TCP response:', response.status, response.statusText);
            return response;
        }
    } catch (error) {
        console.error('Docker API request failed:', error.message);
        console.error('Full error:', error);
        ACTIVE_DOCKER_API = null; // Reset on error
        throw error;
    }
}

// Initialize alarm for periodic checks
chrome.alarms.create('checkDockerStatus', {
    periodInMinutes: 0.5 // Check every 30 seconds
});

// Test Docker API endpoints and set the active one
async function findActiveDockerEndpoint() {
    if (connectionRetryCount >= MAX_RETRIES) {
        console.error('Max retry attempts reached. Please check:');
        console.error('1. Is Docker running?');
        console.error('2. Is the Docker API exposed?');
        console.error('3. Check your firewall settings');
        return false;
    }

    for (const endpoint of DOCKER_API_ENDPOINTS) {
        try {
            console.log(`Attempting to connect to Docker at ${endpoint}...`);
            let response;
            
            if (endpoint.startsWith('unix://')) {
                response = await unixSocketFetch('/version');
            } else {
                // Add proper headers for version check
                response = await fetch(`${endpoint}/version`, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });
            }

            if (response.ok) {
                const version = await response.json();
                console.log('Docker version info:', version);
                console.log(`Successfully connected to Docker API at ${endpoint}`);
                
                // Test container list endpoint specifically
                const containerResponse = await fetch(`${endpoint}/containers/json?all=1`, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!containerResponse.ok) {
                    console.error(`Container endpoint test failed for ${endpoint}`);
                    continue;
                }
                
                const containers = await containerResponse.json();
                console.log(`Container endpoint test successful. Found ${containers.length} containers`);
                
                ACTIVE_DOCKER_API = endpoint;
                connectionRetryCount = 0; // Reset counter on successful connection
                return true;
            }
        } catch (error) {
            console.log(`Failed to connect to ${endpoint}:`, error.message);
            if (endpoint.startsWith('unix://')) {
                console.log('Unix socket connection failed. If on Windows, this is expected.');
            } else {
                console.log('TCP connection failed. Check if Docker API is exposed on port 2375');
            }
        }
    }

    connectionRetryCount++;
    console.error(`Could not connect to Docker API. Attempt ${connectionRetryCount} of ${MAX_RETRIES}`);
    return false;
}

// Initialize connection
findActiveDockerEndpoint().then(success => {
    if (!success) {
        console.error('Failed to connect to Docker API. Please check if Docker is running and properly configured.');
    }
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkDockerStatus') {
        checkContainerHealth();
    }
});

// Check container health and send notifications if needed
async function checkContainerHealth() {
    try {
        const containers = await fetchContainers();
        containers.forEach(container => {
            if (container.State === 'exited' || (container.State === 'running' && container.Status.includes('unhealthy'))) {
                showNotification(container);
            }
        });
    } catch (error) {
        console.error('Error checking container health:', error);
    }
}

// Show notification for container issues
function showNotification(container) {
    chrome.notifications.create(`container-${container.Id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Docker Container Alert',
        message: `Container ${container.Names[0].replace('/', '')} is ${container.State}!`,
        priority: 2
    });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'getContainers':
            fetchContainers().then(sendResponse);
            return true;
        case 'getLogs':
            fetchContainerLogs(request.containerId).then(sendResponse);
            return true;
        case 'getMetrics':
            fetchContainerStats(request.containerId).then(sendResponse);
            return true;
        case 'searchLogs':
            searchContainerLogs(request.containerId, request.searchQuery).then(sendResponse);
            return true;
    }
});

// Fetch container list with stats
async function fetchContainers() {
    try {
        console.log('Fetching containers list...');
        const response = await dockerFetch('/containers/json?all=1');
        console.log('Container list response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const responseText = await response.text();
        console.log('Raw container response:', responseText);
        
        let containers;
        try {
            containers = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse container list:', parseError);
            console.log('Invalid JSON received:', responseText);
            return [];
        }

        console.log('Found containers:', containers.length);
        console.log('Container data:', containers);

        if (!Array.isArray(containers)) {
            console.error('Container response is not an array:', containers);
            return [];
        }
        
        // Fetch stats for each container
        console.log('Fetching stats for containers...');
        const containersWithStats = await Promise.all(
            containers.map(async (container) => {
                try {
                    console.log(`Fetching stats for container ${container.Id}`);
                    const stats = await fetchContainerStats(container.Id);
                    return {
                        ...container,
                        metrics: stats
                    };
                } catch (error) {
                    console.error(`Error fetching stats for container ${container.Id}:`, error);
                    return {
                        ...container,
                        metrics: null
                    };
                }
            })
        );
        
        console.log('Final containers with stats:', containersWithStats);
        return containersWithStats;
    } catch (error) {
        console.error('Error in fetchContainers:', error);
        console.error('Stack trace:', error.stack);
        return [];
    }
}

// Fetch container logs
async function fetchContainerLogs(containerId) {
    try {
        const response = await dockerFetch(
            `/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=1&tail=100`
        );
        const text = await response.text();
        
        // Parse Docker logs format
        const logs = text.split('\n')
            .filter(line => line.trim())
            .map(line => {
                // Remove Docker log header (first 8 bytes)
                const cleanLine = line.substring(8);
                const timestamp = cleanLine.substring(0, 30);
                const message = cleanLine.substring(31);
                return {
                    timestamp,
                    message,
                    level: message.toLowerCase().includes('error') ? 'error' :
                           message.toLowerCase().includes('warn') ? 'warning' : 'info'
                };
            });

        return { logs };
    } catch (error) {
        console.error('Error fetching container logs:', error);
        return { error: 'Failed to fetch logs' };
    }
}

// Fetch container stats
async function fetchContainerStats(containerId) {
    try {
        const response = await dockerFetch(`/containers/${containerId}/stats?stream=false`);
        const stats = await response.json();

        return {
            cpu: calculateCPUPercentage(stats),
            memory: stats.memory_stats.usage,
            network: {
                rx: stats.networks?.eth0?.rx_bytes || 0,
                tx: stats.networks?.eth0?.tx_bytes || 0
            },
            disk: {
                read: stats.blkio_stats.io_service_bytes_recursive?.[0]?.value || 0,
                write: stats.blkio_stats.io_service_bytes_recursive?.[1]?.value || 0
            }
        };
    } catch (error) {
        console.error('Error fetching container stats:', error);
        return null;
    }
}

// Search container logs
async function searchContainerLogs(containerId, searchQuery) {
    try {
        const response = await dockerFetch(
            `/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=1&tail=1000`
        );
        const text = await response.text();
        
        // Parse and filter logs
        const logs = text.split('\n')
            .filter(line => {
                const cleanLine = line.substring(8); // Remove Docker log header
                return cleanLine.trim() && cleanLine.toLowerCase().includes(searchQuery.toLowerCase());
            })
            .map(line => {
                const cleanLine = line.substring(8);
                const timestamp = cleanLine.substring(0, 30);
                const message = cleanLine.substring(31);
                return {
                    timestamp,
                    message,
                    level: message.toLowerCase().includes('error') ? 'error' :
                           message.toLowerCase().includes('warn') ? 'warning' : 'info'
                };
            });

        return { logs };
    } catch (error) {
        console.error('Error searching logs:', error);
        return { error: 'Failed to search logs' };
    }
}

// Calculate CPU percentage from stats
function calculateCPUPercentage(stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;

    if (systemDelta <= 0 || cpuDelta <= 0) return 0;

    return (cpuDelta / systemDelta) * cpuCount * 100;
} 