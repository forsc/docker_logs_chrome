// Docker API endpoints in order of preference
const DOCKER_API_ENDPOINTS = [
    'http://localhost:2375',        // TCP primary
    'http://127.0.0.1:2375'         // TCP alternative
];

// Check if we're on Windows
const isWindows = navigator.platform.toLowerCase().includes('win');

if (!isWindows) {
    // Only add Unix socket for non-Windows platforms
    DOCKER_API_ENDPOINTS.unshift('unix:///var/run/docker.sock');
}

let ACTIVE_DOCKER_API = null;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds between retries

// Helper function to add CORS headers
function addCorsHeaders(options = {}) {
    return {
        ...options,
        headers: {
            ...options.headers,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': chrome.runtime.getURL(''),
            'Cache-Control': 'no-cache'
        },
        mode: 'cors'
    };
}

// Helper function to handle Unix socket requests
async function unixSocketFetch(path, options = {}) {
    try {
        console.log('Attempting Unix socket connection...', path);
        if (isWindows) {
            throw new Error('Unix socket not supported on Windows');
        }

        // Ensure the path starts with a slash
        const apiPath = path.startsWith('/') ? path : `/${path}`;
        
        // Format the URL properly for Unix socket
        const url = `http://localhost${apiPath}`;
        
        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Host': 'localhost'
            }
        });

        if (!response.ok) {
            console.error('Unix socket request failed:', response.status, response.statusText);
            throw new Error(`Unix socket request failed: ${response.status}`);
        }

        console.log('Unix socket response:', response.status, response.statusText);
        return response;
    } catch (error) {
        console.error('Unix socket connection failed:', error.message);
        if (error.message.includes('Failed to fetch')) {
            console.log('This might be a CORS issue or the Docker socket is not accessible');
        }
        throw error;
    }
}

// Helper function to make Docker API requests
async function dockerFetch(path, options = {}) {
    if (!ACTIVE_DOCKER_API) {
        console.log('No active Docker API, attempting to find endpoint...');
        const success = await findActiveDockerEndpoint();
        if (!success || !ACTIVE_DOCKER_API) {
            throw new Error('No active Docker API endpoint available');
        }
    }

    try {
        console.log(`Making request to ${ACTIVE_DOCKER_API}${path}`);
        
        const finalOptions = addCorsHeaders(options);
        const response = await fetch(`${ACTIVE_DOCKER_API}${path}`, finalOptions);
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response;
    } catch (error) {
        console.error('Docker API request failed:', error.message);
        
        // Reset API endpoint and retry on connection errors
        if (error.message.includes('Failed to fetch') || 
            error.message.includes('NetworkError') ||
            error.message.includes('ECONNREFUSED')) {
            console.log('Connection error detected, resetting API endpoint');
            ACTIVE_DOCKER_API = null;
            
            // Retry the request if we haven't exceeded the retry limit
            if (connectionRetryCount < MAX_RETRIES) {
                console.log(`Retrying request (attempt ${connectionRetryCount + 1} of ${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return dockerFetch(path, options);
            }
        }
        
        throw error;
    }
}

// Initialize alarm for periodic checks
chrome.alarms.create('checkDockerStatus', {
    periodInMinutes: 0.25 // Check every 15 seconds
});

// Test Docker API endpoints and set the active one
async function findActiveDockerEndpoint() {
    if (connectionRetryCount >= MAX_RETRIES) {
        console.error('Max retry attempts reached. Please check:');
        console.error('1. Is Docker running?');
        console.error('2. Is the Docker API exposed?');
        console.error('3. Check your firewall settings');
        if (isWindows) {
            console.error('4. For Windows: Make sure "Expose daemon on tcp://localhost:2375 without TLS" is enabled in Docker Desktop');
        } else {
            console.error('4. For Linux: Check Docker socket permissions (sudo chmod 666 /var/run/docker.sock)');
        }
        return false;
    }

    for (const endpoint of DOCKER_API_ENDPOINTS) {
        try {
            console.log(`Attempting to connect to Docker at ${endpoint}...`);
            
            const options = addCorsHeaders();
            const response = await fetch(`${endpoint}/version`, options);
            
            if (!response.ok) {
                console.log(`Endpoint ${endpoint} returned status ${response.status}`);
                continue;
            }

            const version = await response.json();
            console.log('Docker version info:', version);
            
            // Test container list endpoint
            const containerResponse = await fetch(`${endpoint}/containers/json?all=1`, options);
            
            if (!containerResponse.ok) {
                console.error(`Container endpoint test failed for ${endpoint}`);
                continue;
            }
            
            const containers = await containerResponse.json();
            console.log(`Container endpoint test successful. Found ${containers.length} containers`);
            
            ACTIVE_DOCKER_API = endpoint;
            connectionRetryCount = 0; // Reset counter on successful connection
            return true;
        } catch (error) {
            console.log(`Failed to connect to ${endpoint}:`, error.message);
            console.log('Will try next endpoint or retry...');
        }
    }

    connectionRetryCount++;
    console.error(`Could not connect to Docker API. Attempt ${connectionRetryCount} of ${MAX_RETRIES}`);
    
    // Add delay between retries
    if (connectionRetryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return findActiveDockerEndpoint();
    }
    
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

// Enhanced container health check function
async function checkContainerHealth() {
    try {
        const containers = await fetchContainers();
        containers.forEach(container => {
            // Check various failure conditions
            const isUnhealthy = 
                container.State === 'exited' || 
                container.State === 'dead' ||
                container.State === 'restarting' ||
                (container.State === 'running' && container.Status.includes('unhealthy')) ||
                container.Status.includes('(Restarting)') ||
                (container.State === 'running' && container.RestartCount > 3);

            if (isUnhealthy) {
                const reason = getUnhealthyReason(container);
                showContainerAlert(container, reason);
            }
        });
    } catch (error) {
        console.error('Error checking container health:', error);
        showError('Container Health Check Failed', 'Unable to monitor container health: ' + error.message);
    }
}

// Get the reason for unhealthy state
function getUnhealthyReason(container) {
    if (container.State === 'exited') {
        const exitCode = container.Status.match(/\((\d+)\)/)?.[1] || 'unknown';
        return `Container exited with code ${exitCode}`;
    }
    if (container.State === 'dead') return 'Container is in dead state';
    if (container.State === 'restarting') return 'Container is stuck in restarting loop';
    if (container.Status.includes('unhealthy')) return 'Container health check failed';
    if (container.Status.includes('(Restarting)')) return 'Container is repeatedly restarting';
    if (container.RestartCount > 3) return `Container has restarted ${container.RestartCount} times`;
    return 'Container is in an unhealthy state';
}

// Enhanced notification function with simplified format
function showContainerAlert(container, reason) {
    const containerName = container.Names[0].replace('/', '');
    const notificationId = `container-${container.Id}-${Date.now()}`;

    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Container Alert',
        message: `${containerName}: ${reason}`,
        priority: 2,
        buttons: [
            { title: 'View Logs' },
            { title: 'Restart Container' }
        ]
    });
}

// Show error notifications
function showError(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message,
        priority: 2
    });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const containerId = notificationId.split('-')[1];
    
    if (buttonIndex === 0) {
        // View logs
        chrome.runtime.sendMessage({
            action: 'viewLogs',
            containerId: containerId
        });
    } else if (buttonIndex === 1) {
        // Restart container
        restartContainer(containerId);
    }
});

// Function to restart a container
async function restartContainer(containerId) {
    try {
        await dockerFetch(`/containers/${containerId}/restart`, {
            method: 'POST'
        });
        
        showContainerAlert({
            Id: containerId,
            Names: ['Container'],
            State: 'restarting'
        }, 'Container restart initiated');
    } catch (error) {
        console.error('Error restarting container:', error);
        showError('Restart Failed', `Failed to restart container: ${error.message}`);
    }
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