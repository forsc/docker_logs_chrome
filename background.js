const DOCKER_API = 'http://localhost:2375';
const CHECK_INTERVAL = 30000; // 30 seconds

// Initialize alarm for periodic checks
chrome.alarms.create('checkDockerStatus', {
    periodInMinutes: 0.5 // Check every 30 seconds
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
        const response = await fetch(`${DOCKER_API}/containers/json?all=1`);
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
        return [];
    }
}

// Fetch container logs
async function fetchContainerLogs(containerId) {
    try {
        const response = await fetch(
            `${DOCKER_API}/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=1&tail=100`
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
        const response = await fetch(`${DOCKER_API}/containers/${containerId}/stats?stream=false`);
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
        const response = await fetch(
            `${DOCKER_API}/containers/${containerId}/logs?stdout=1&stderr=1&timestamps=1&tail=1000`
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