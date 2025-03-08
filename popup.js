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

    // Load initial data
    loadContainers();
    startMetricsUpdates();

    // Event listeners
    containerSelect.addEventListener('change', (e) => {
        selectedContainerId = e.target.value;
        loadContainerLogs(selectedContainerId);
    });

    searchBtn.addEventListener('click', () => {
        if (selectedContainerId && searchInput.value.trim()) {
            searchLogs(selectedContainerId, searchInput.value.trim());
        }
    });

    refreshLogsBtn.addEventListener('click', () => {
        if (selectedContainerId) {
            loadContainerLogs(selectedContainerId);
        }
    });

    // Load containers list
    async function loadContainers() {
        const response = await chrome.runtime.sendMessage({ action: 'getContainers' });
        containers = response || [];
        updateContainersList();
        updateContainerSelect();
    }

    // Update containers list UI
    function updateContainersList() {
        containersList.innerHTML = '';
        containers.forEach(container => {
            const card = document.createElement('div');
            card.className = `container-card ${container.status === 'running' ? 'running' : 'stopped'}`;
            card.innerHTML = `
                <h3>${container.name}</h3>
                <p>Status: ${container.status}</p>
                <p>ID: ${container.id.slice(0, 12)}</p>
            `;
            containersList.appendChild(card);
        });
    }

    // Update container select dropdown
    function updateContainerSelect() {
        containerSelect.innerHTML = '<option value="">Select Container</option>';
        containers.forEach(container => {
            const option = document.createElement('option');
            option.value = container.id;
            option.textContent = container.name;
            containerSelect.appendChild(option);
        });
    }

    // Load container logs
    async function loadContainerLogs(containerId) {
        if (!containerId) return;

        const response = await chrome.runtime.sendMessage({
            action: 'getLogs',
            containerId
        });

        if (response.error) {
            logsOutput.innerHTML = `<p class="error">${response.error}</p>`;
            return;
        }

        displayLogs(response.logs);
    }

    // Search logs
    async function searchLogs(containerId, query) {
        const response = await chrome.runtime.sendMessage({
            action: 'searchLogs',
            containerId,
            searchQuery: query
        });

        if (response.error) {
            logsOutput.innerHTML = `<p class="error">${response.error}</p>`;
            return;
        }

        displayLogs(response.logs);
    }

    // Display logs in the UI
    function displayLogs(logs) {
        logsOutput.innerHTML = '';
        logs.forEach(log => {
            const logLine = document.createElement('div');
            logLine.className = 'log-line';
            if (log.level === 'error') {
                logLine.classList.add('error');
            } else if (log.level === 'warning') {
                logLine.classList.add('warning');
            }
            logLine.textContent = `[${log.timestamp}] ${log.message}`;
            logsOutput.appendChild(logLine);
        });
        logsOutput.scrollTop = logsOutput.scrollHeight;
    }

    // Update metrics
    async function updateMetrics() {
        const containers = await chrome.runtime.sendMessage({ action: 'getContainers' });
        
        if (!containers || !containers.length) return;

        const totalMetrics = containers.reduce((acc, container) => {
            return {
                cpu: acc.cpu + (container.metrics?.cpu || 0),
                memory: acc.memory + (container.metrics?.memory || 0),
                network: {
                    rx: acc.network.rx + (container.metrics?.network?.rx || 0),
                    tx: acc.network.tx + (container.metrics?.network?.tx || 0)
                },
                disk: {
                    read: acc.disk.read + (container.metrics?.disk?.read || 0),
                    write: acc.disk.write + (container.metrics?.disk?.write || 0)
                }
            };
        }, { cpu: 0, memory: 0, network: { rx: 0, tx: 0 }, disk: { read: 0, write: 0 } });

        // Update metrics display
        document.getElementById('cpuUsage').textContent = `${totalMetrics.cpu.toFixed(2)}%`;
        document.getElementById('memoryUsage').textContent = formatBytes(totalMetrics.memory);
        document.getElementById('networkIO').textContent = `↓${formatBytes(totalMetrics.network.rx)}/s\n↑${formatBytes(totalMetrics.network.tx)}/s`;
        document.getElementById('diskIO').textContent = `R:${formatBytes(totalMetrics.disk.read)}/s\nW:${formatBytes(totalMetrics.disk.write)}/s`;
    }

    // Start periodic metrics updates
    function startMetricsUpdates() {
        updateMetrics();
        setInterval(updateMetrics, 2000); // Update every 2 seconds
    }

    // Utility function to format bytes
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}); 