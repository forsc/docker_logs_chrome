document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI elements
    const containersList = document.getElementById('containersList');
    const containerSelect = document.getElementById('containerSelect');
    const logsOutput = document.getElementById('logsOutput');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const refreshLogsBtn = document.getElementById('refreshLogs');

    let selectedContainerId = '';
    let containers = [];

    // Debounce function for performance
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Enhance loadContainers with debouncing and loading indicator
    const debouncedLoadContainers = debounce(async () => {
        const loadingSpinner = document.querySelector('.loading-spinner');
        if (loadingSpinner) loadingSpinner.classList.add('active');
        
        try {
            const containers = await chrome.runtime.sendMessage({ action: 'getContainers' });
            updateContainersList(containers);
        } catch (error) {
            showError('Failed to load containers: ' + error.message);
        } finally {
            if (loadingSpinner) loadingSpinner.classList.remove('active');
        }
    }, 300);

    // Enhance loadContainerLogs with debouncing and loading indicator
    const debouncedLoadContainerLogs = debounce(async (containerId) => {
        const logsLoadingSpinner = document.querySelector('.logs-loading-spinner');
        if (logsLoadingSpinner) logsLoadingSpinner.classList.add('active');
        
        try {
            const logs = await chrome.runtime.sendMessage({
                action: 'getContainerLogs',
                containerId: containerId
            });
            displayLogs(logs);
        } catch (error) {
            showError('Failed to load logs: ' + error.message);
        } finally {
            if (logsLoadingSpinner) logsLoadingSpinner.classList.remove('active');
        }
    }, 300);

    // Load initial data
    loadContainers(); // Immediate load
    debouncedLoadContainers(); // Setup debounced updates
    startMetricsUpdates();

    // Event listeners
    containerSelect.addEventListener('change', (e) => {
        selectedContainerId = e.target.value;
        if (selectedContainerId) {
            debouncedLoadContainerLogs(selectedContainerId);
        }
    });

    searchBtn.addEventListener('click', () => {
        if (selectedContainerId && searchInput.value.trim()) {
            searchLogs(selectedContainerId, searchInput.value.trim());
        }
    });

    refreshLogsBtn.addEventListener('click', () => {
        debouncedLoadContainers();
    });

    // Draggable window functionality
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    function dragStart(e) {
        if (e.target.closest('.titlebar') && !e.target.closest('.window-controls')) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        }
    }

    function dragEnd() {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            setTranslate(currentX, currentY, document.querySelector('.window'));
        }
    }

    function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate(${xPos}px, ${yPos}px)`;
    }

    // Initialize draggable functionality
    document.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('mouseleave', dragEnd);

    // Load containers list
    async function loadContainers() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getContainers' });
            console.log('Containers response:', response);
            containers = Array.isArray(response) ? response : [];
            console.log('Processed containers:', containers);
            updateContainersList();
            updateContainerSelect();
        } catch (error) {
            console.error('Error loading containers:', error);
            showError('Failed to load containers. Please check if Docker is running.');
        }
    }

    // Update containers list UI
    function updateContainersList() {
        console.log('Updating containers list, element exists:', !!containersList);
        if (!containersList) {
            console.error('Container list element not found!');
            return;
        }
        
        containersList.innerHTML = '';
        if (containers.length === 0) {
            console.log('No containers to display');
            containersList.innerHTML = '<div class="no-containers">No containers found</div>';
            return;
        }

        console.log('Rendering containers:', containers.length);
        containers.forEach(container => {
            if (!container || !container.Id) {
                console.log('Skipping invalid container:', container);
                return;
            }

            const card = document.createElement('div');
            card.className = `container-card ${getContainerStatusClass(container.State)}`;
            
            const name = container.Names && container.Names[0] ? 
                        container.Names[0].replace('/', '') : 
                        'Unnamed Container';
            
            const shortId = container.Id ? container.Id.slice(0, 12) : 'Unknown ID';
            const state = container.State || 'unknown';

            card.innerHTML = `
                <h3>${escapeHtml(name)}</h3>
                <p>Status: ${escapeHtml(state)}</p>
                <p>ID: ${escapeHtml(shortId)}</p>
            `;
            containersList.appendChild(card);
        });
    }

    // Update container select dropdown
    function updateContainerSelect() {
        if (!containerSelect) return;

        containerSelect.innerHTML = '<option value="">Select Container</option>';
        containers.forEach(container => {
            if (!container || !container.Id) return;

            const option = document.createElement('option');
            option.value = container.Id;
            const name = container.Names && container.Names[0] ? 
                        container.Names[0].replace('/', '') : 
                        'Unnamed Container';
            option.textContent = name;
            containerSelect.appendChild(option);
        });
    }

    // Load container logs
    async function loadContainerLogs(containerId) {
        if (!containerId) return;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getLogs',
                containerId
            });

            if (response.error) {
                showError(response.error);
                return;
            }

            displayLogs(response.logs || []);
        } catch (error) {
            console.error('Error loading logs:', error);
            showError('Failed to load container logs');
        }
    }

    // Search logs
    async function searchLogs(containerId, query) {
        if (!containerId || !query) return;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'searchLogs',
                containerId,
                searchQuery: query
            });

            if (response.error) {
                showError(response.error);
                return;
            }

            displayLogs(response.logs || []);
        } catch (error) {
            console.error('Error searching logs:', error);
            showError('Failed to search logs');
        }
    }

    // Display logs in the UI
    function displayLogs(logs) {
        if (!logsOutput) return;

        logsOutput.innerHTML = '';
        if (!Array.isArray(logs) || logs.length === 0) {
            logsOutput.innerHTML = '<div class="no-logs">No logs found</div>';
            return;
        }

        logs.forEach(log => {
            if (!log) return;

            const logLine = document.createElement('div');
            logLine.className = `log-line ${log.level || 'info'}`;
            logLine.textContent = `[${log.timestamp || ''}] ${log.message || ''}`;
            logsOutput.appendChild(logLine);
        });
        logsOutput.scrollTop = logsOutput.scrollHeight;
    }

    // Update metrics
    async function updateMetrics() {
        try {
            const containers = await chrome.runtime.sendMessage({ action: 'getContainers' });
            console.log('Metrics containers response:', containers);
            if (!Array.isArray(containers) || containers.length === 0) {
                console.log('No containers found for metrics');
                return;
            }

            const totalMetrics = containers.reduce((acc, container) => {
                console.log('Processing metrics for container:', container.Id);
                const metrics = container.metrics || {};
                return {
                    cpu: acc.cpu + (metrics.cpu || 0),
                    memory: acc.memory + (metrics.memory || 0),
                    network: {
                        rx: acc.network.rx + (metrics.network?.rx || 0),
                        tx: acc.network.tx + (metrics.network?.tx || 0)
                    },
                    disk: {
                        read: acc.disk.read + (metrics.disk?.read || 0),
                        write: acc.disk.write + (metrics.disk?.write || 0)
                    }
                };
            }, { cpu: 0, memory: 0, network: { rx: 0, tx: 0 }, disk: { read: 0, write: 0 } });

            console.log('Calculated metrics:', totalMetrics);
            updateMetricDisplay('cpuUsage', `${totalMetrics.cpu.toFixed(2)}%`);
            updateMetricDisplay('memoryUsage', formatBytes(totalMetrics.memory));
            updateMetricDisplay('networkIO', `↓${formatBytes(totalMetrics.network.rx)}/s\n↑${formatBytes(totalMetrics.network.tx)}/s`);
            updateMetricDisplay('diskIO', `R:${formatBytes(totalMetrics.disk.read)}/s\nW:${formatBytes(totalMetrics.disk.write)}/s`);
        } catch (error) {
            console.error('Error updating metrics:', error);
        }
    }

    // Update metric display
    function updateMetricDisplay(elementId, value) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Metric element not found: ${elementId}`);
            return;
        }
        console.log(`Updating metric ${elementId} with value:`, value);
        element.textContent = value;
    }

    // Start periodic metrics updates
    function startMetricsUpdates() {
        updateMetrics();
        setInterval(updateMetrics, 2000); // Update every 2 seconds
    }

    // Helper function to format bytes
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    // Helper function to get container status class
    function getContainerStatusClass(state) {
        if (!state) return 'unknown';
        state = state.toLowerCase();
        if (state === 'running') return 'running';
        if (state === 'exited') return 'stopped';
        return 'unknown';
    }

    // Helper function to escape HTML
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Show error message
    function showError(message) {
        if (!containersList) return;
        containersList.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
    }

    // Add pin button functionality
    const pinButton = document.querySelector('#pin-button');
    if (pinButton) {
        pinButton.addEventListener('click', () => {
            const window = document.querySelector('.window');
            window.classList.toggle('pinned');
            pinButton.textContent = window.classList.contains('pinned') ? '📌' : '📍';
        });
    }
}); 