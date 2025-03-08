// Try different Docker API endpoints
const DOCKER_API_ENDPOINTS = [
    'http://localhost:2375',
    'http://127.0.0.1:2375'
];

let ACTIVE_DOCKER_API = null;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;

// Initialize alarm for periodic checks
chrome.alarms.create('checkDockerStatus', {
    periodInMinutes: 0.5 // Check every 30 seconds
});

// Test Docker API endpoints and set the active one
async function findActiveDockerEndpoint() {
    if (connectionRetryCount >= MAX_RETRIES) {
        console.error('Max retry attempts reached. Please check if Docker Desktop is running and the API is exposed.');
        return false;
    }

    for (const endpoint of DOCKER_API_ENDPOINTS) {
        try {
            console.log(`Attempting to connect to ${endpoint}...`);
            const response = await fetch(`${endpoint}/version`);
            if (response.ok) {
                const version = await response.json();
                console.log(`Connected to Docker API at ${endpoint}`, version);
                ACTIVE_DOCKER_API = endpoint;
                connectionRetryCount = 0; // Reset counter on successful connection
                return true;
            }
        } catch (error) {
            console.log(`Failed to connect to ${endpoint}:`, error);
        }
    }

    connectionRetryCount++;
    console.error(`Could not connect to Docker API. Attempt ${connectionRetryCount} of ${MAX_RETRIES}`);
    return false;
}

// Initialize connection
findActiveDockerEndpoint().then(success => {
    if (!success) {
        console.error('Failed to connect to Docker API. Please check if Docker Desktop is running and properly configured.');
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
    if (!ACTIVE_DOCKER_API) {
        await findActiveDockerEndpoint();
        if (!ACTIVE_DOCKER_API) return;
    }

    try {
        const containers = await fetchContainers();
        containers.forEach(container => {
            if (container.State === 'exited' || (container.State === 'running' && container.Status.includes('unhealthy'))) {
                showNotification(container);
            }
        });
    } catch (error) {
        console.error('Error checking container health:', error);
        // If we get an error, try to find a working endpoint again
        ACTIVE_DOCKER_API = null;
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
    if (!ACTIVE_DOCKER_API) {
        await findActiveDockerEndpoint();
        if (!ACTIVE_DOCKER_API) return [];
    }

    try {
        const response = await fetch(`${ACTIVE_DOCKER_API}/containers/json?all=1`);
        const containers = await response.json();
        
        // Fetch stats for each container
        const containersWithStats = await Promise.all(
            containers.map(async (container) => {
                try {
                    const stats = await fetchContainerStats(container.Id);
                    return {
                        ...container,
                        metrics: stats
                    };
                } catch (error) {
                    console.error(`Error fetching stats for container ${container.Id}:`, error);
                    return container;
                }
            })
        );
        
        return containersWithStats;
    } catch (error) {
        console.error('Error fetching containers:', error);
        ACTIVE_DOCKER_API = null; // Reset API endpoint if we get an error
        return [];
    }
}

// Fetch container logs
async function fetchContainerLogs(containerId) {
    if (!ACTIVE_DOCKER_API) {
        await findActiveDockerEndpoint();
        if (!ACTIVE_DOCKER_API) return { error: 'Docker API not available' };
    }

    try {
        const response = await fetch(
            `${ACTIVE_DOCKER_API}/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=1&tail=100`
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
        ACTIVE_DOCKER_API = null;
        return { error: 'Failed to fetch logs' };
    }
}

// Fetch container stats
async function fetchContainerStats(containerId) {
    if (!ACTIVE_DOCKER_API) {
        await findActiveDockerEndpoint();
        if (!ACTIVE_DOCKER_API) return null;
    }

    try {
        const response = await fetch(`${ACTIVE_DOCKER_API}/containers/${containerId}/stats?stream=false`);
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
        ACTIVE_DOCKER_API = null;
        return null;
    }
}

// Search container logs
async function searchContainerLogs(containerId, searchQuery) {
    if (!ACTIVE_DOCKER_API) {
        await findActiveDockerEndpoint();
        if (!ACTIVE_DOCKER_API) return { error: 'Docker API not available' };
    }

    try {
        const response = await fetch(
            `${ACTIVE_DOCKER_API}/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=1&tail=1000`
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
        ACTIVE_DOCKER_API = null;
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