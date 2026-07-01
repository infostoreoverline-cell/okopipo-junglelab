/* ══════════════════════════════════════════════════════════════════
   OKOPIPI JUNGLE LAB — Climate Monitoring App JavaScript Logic v1.0
   ══════════════════════════════════════════════════════════════════ */

// ── STATO GLOBALE DELL'APPLICAZIONE ───────────────────────────────
const AppState = {
    scriptUrl: localStorage.getItem('okopipi_script_url') || 'https://script.google.com/macros/s/AKfycbyRDURF4GQMy5dC9_0LdXAObEXHyYUvm6HR1qFAVTFgWLHl9LL9NOZCI3hToTnqWIvwzQ/exec',
    activeRange: '7d',
    selectedDevice: 'all',
    rawData: [],
    sensorsMap: {},
    chartInstance: null,
    refreshInterval: null
};

// ── ELEMENTI DEL DOM ──────────────────────────────────────────────
const DOM = {
    setupGuide: document.getElementById('setupGuide'),
    scriptUrlInput: document.getElementById('scriptUrlInput'),
    btnSaveUrl: document.getElementById('btnSaveUrl'),
    
    dashboardMain: document.getElementById('dashboardMain'),
    deviceSelector: document.getElementById('deviceSelector'),
    lastUpdatedTime: document.getElementById('lastUpdatedTime'),
    
    currentTemp: document.getElementById('currentTemp'),
    currentHum: document.getElementById('currentHum'),
    
    chartSpinner: document.getElementById('chartSpinner'),
    emptyDataPlaceholder: document.getElementById('emptyDataPlaceholder'),
    climateChartCanvas: document.getElementById('climateChart'),
    
    tempMin: document.getElementById('tempMin'),
    tempAvg: document.getElementById('tempAvg'),
    tempMax: document.getElementById('tempMax'),
    
    humMin: document.getElementById('humMin'),
    humAvg: document.getElementById('humAvg'),
    humMax: document.getElementById('humMax'),
    
    readingsTableBody: document.querySelector('#readingsTable tbody'),
    
    btnResetConfig: document.getElementById('btnResetConfig'),
    rangeButtons: document.querySelectorAll('.btn-range')
};

// ── ACCENSIONE E INIZIALIZZAZIONE ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    
    if (!AppState.scriptUrl) {
        // Mostra guida di setup se la URL manca
        DOM.setupGuide.style.display = 'block';
        DOM.dashboardMain.style.display = 'none';
        DOM.btnResetConfig.style.display = 'none';
    } else {
        // Avvia dashboard
        DOM.setupGuide.style.display = 'none';
        DOM.dashboardMain.style.display = '';
        DOM.btnResetConfig.style.display = 'inline-block';
        
        // Carica dati
        fetchData();
        
        // Imposta auto-aggiornamento ogni 60 secondi
        if (AppState.refreshInterval) clearInterval(AppState.refreshInterval);
        AppState.refreshInterval = setInterval(fetchData, 60000);
    }
}

// ── EVENT LISTENERS ───────────────────────────────────────────────
function setupEventListeners() {
    // Bottone Salva Configurazione
    DOM.btnSaveUrl.addEventListener('click', () => {
        const url = DOM.scriptUrlInput.value.trim();
        if (url && url.startsWith('https://script.google.com/')) {
            localStorage.setItem('okopipi_script_url', url);
            AppState.scriptUrl = url;
            initApp();
        } else {
            alert('Inserisci una URL valida di Google Apps Script (deve iniziare con https://script.google.com/)');
        }
    });

    // Reset Configurazione
    DOM.btnResetConfig.addEventListener('click', () => {
        if (confirm('Sei sicuro di voler modificare la URL di Google Apps Script?')) {
            localStorage.removeItem('okopipi_script_url');
            AppState.scriptUrl = '';
            if (AppState.refreshInterval) clearInterval(AppState.refreshInterval);
            initApp();
        }
    });

    // Selettore Terrario / Dispositivo
    DOM.deviceSelector.addEventListener('change', (e) => {
        AppState.selectedDevice = e.target.value;
        renderDashboard();
    });

    // Selettore Range Temporale
    DOM.rangeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            // Rimuovi classe attiva da tutti i bottoni del range
            DOM.rangeButtons.forEach(btn => btn.classList.remove('active'));
            // Aggiungi al bottone cliccato
            e.target.classList.add('active');
            
            AppState.activeRange = e.target.getAttribute('data-range');
            fetchData();
        });
    });
}

// ── FETCH DEI DATI DA GOOGLE SHEETS backend ────────────────────────
async function fetchData() {
    if (!AppState.scriptUrl) return;

    // Mostra caricamento
    DOM.chartSpinner.style.display = 'flex';
    DOM.emptyDataPlaceholder.style.display = 'none';
    if (DOM.climateChartCanvas) DOM.climateChartCanvas.style.opacity = '0.3';

    try {
        // Chiamata GET all'endpoint di GAS con il parametro di range temporale
        const fetchUrl = `${AppState.scriptUrl}?range=${AppState.activeRange}`;
        const response = await fetch(fetchUrl, { method: 'GET', redirect: 'follow' });
        
        if (!response.ok) {
            throw new Error(`Risposta del server non valida: ${response.status}`);
        }
        
        const resJson = await response.json();
        
        if (resJson.status === 'success') {
            AppState.rawData = resJson.data || [];
            AppState.sensorsMap = resJson.sensors || {};
            
            // Popola il selettore dei dispositivi
            populateDeviceSelector();
            
            // Renderizza i grafici e le tabelle
            renderDashboard();
            
            // Aggiorna l'orario di ultimo aggiornamento
            const oraStr = new Date().toLocaleTimeString('it-IT');
            DOM.lastUpdatedTime.textContent = `Ultimo aggiornamento: ${oraStr}`;
        } else {
            throw new Error(resJson.message || 'Errore sconosciuto nel backend.');
        }
        
    } catch (error) {
        console.error('Errore nel fetch dei dati:', error);
        DOM.emptyDataPlaceholder.style.display = 'flex';
        DOM.emptyDataPlaceholder.querySelector('p').textContent = 'Errore di connessione al foglio Google.';
        DOM.emptyDataPlaceholder.querySelector('.placeholder-subtext').textContent = 
            'Verifica che la URL sia corretta e che la Web App sia pubblicata con accesso impostato su "Chiunque".';
    } finally {
        DOM.chartSpinner.style.display = 'none';
        if (DOM.climateChartCanvas) DOM.climateChartCanvas.style.opacity = '1';
    }
}

// ── POPOLA SELETTORE DISPOSITIVI ──────────────────────────────────
function populateDeviceSelector() {
    // Salva la selezione attuale
    const currentSelection = AppState.selectedDevice;
    
    // Svuota tranne l'opzione "Tutti"
    DOM.deviceSelector.innerHTML = '<option value="all">Tutti i Terrari</option>';
    
    // Inserisci le chiavi trovate nella mappa sensori
    const keys = Object.keys(AppState.sensorsMap);
    keys.forEach(mac => {
        const name = AppState.sensorsMap[mac] || mac;
        const opt = document.createElement('option');
        opt.value = mac;
        opt.textContent = name;
        DOM.deviceSelector.appendChild(opt);
    });
    
    // Ripristina la selezione precedente se è ancora presente nel pool
    if (currentSelection === 'all' || keys.includes(currentSelection)) {
        DOM.deviceSelector.value = currentSelection;
        AppState.selectedDevice = currentSelection;
    } else {
        DOM.deviceSelector.value = 'all';
        AppState.selectedDevice = 'all';
    }
}

// ── APPLICA I FILTRI E DISEGNA LA DASHBOARD ──────────────────────
function renderDashboard() {
    // 1. Filtra i dati per il dispositivo selezionato
    let filteredData = AppState.rawData;
    if (AppState.selectedDevice !== 'all') {
        filteredData = AppState.rawData.filter(item => item.device_id === AppState.selectedDevice);
    }
    
    // Se non ci sono dati, mostra placeholder vuoto
    if (filteredData.length === 0) {
        DOM.emptyDataPlaceholder.style.display = 'flex';
        DOM.currentTemp.textContent = '--.-';
        DOM.currentHum.textContent = '--.-';
        DOM.tempMin.textContent = '--.-';
        DOM.tempAvg.textContent = '--.-';
        DOM.tempMax.textContent = '--.-';
        DOM.humMin.textContent = '--.-';
        DOM.humAvg.textContent = '--.-';
        DOM.humMax.textContent = '--.-';
        DOM.readingsTableBody.innerHTML = `<tr><td colspan="4" class="table-empty">Nessun dato registrato.</td></tr>`;
        
        if (AppState.chartInstance) {
            AppState.chartInstance.destroy();
            AppState.chartInstance = null;
        }
        return;
    }
    
    DOM.emptyDataPlaceholder.style.display = 'none';

    // 2. Calcola e mostra valori attuali (l'ultimo record nell'array cronologico)
    const latestRecord = filteredData[filteredData.length - 1];
    DOM.currentTemp.textContent = latestRecord.temperature !== null ? latestRecord.temperature.toFixed(1) : '--.-';
    DOM.currentHum.textContent = latestRecord.humidity !== null ? latestRecord.humidity.toFixed(1) : '--.-';

    // 3. Disegna il grafico Chart.js
    renderChart(filteredData);
    
    // 4. Calcola statistiche periodo
    calculateStats(filteredData);
    
    // 5. Popola la tabella dei record recenti
    populateTable(filteredData);
}

// ── DISEGNA IL GRAFICO CLIMATICO (CHART.JS) ──────────────────────
function renderChart(data) {
    if (AppState.chartInstance) {
        AppState.chartInstance.destroy();
    }
    
    // Estrai etichette (timestamp) e valori
    const labels = data.map(item => {
        const date = new Date(item.timestamp);
        // Se visualizziamo le ultime 24 ore, mostra solo l'ora, altrimenti mostra giorno/mese e ora
        if (AppState.activeRange === '24h') {
            return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
    });
    
    const tempDataset = data.map(item => item.temperature);
    const humDataset = data.map(item => item.humidity);
    
    const ctx = DOM.climateChartCanvas.getContext('2d');
    
    // Genera gradienti per le aree sottostanti le curve (Stile premium)
    const tempGrad = ctx.createLinearGradient(0, 0, 0, 300);
    tempGrad.addColorStop(0, 'rgba(255, 71, 87, 0.2)');
    tempGrad.addColorStop(1, 'rgba(255, 71, 87, 0.0)');
    
    const humGrad = ctx.createLinearGradient(0, 0, 0, 300);
    humGrad.addColorStop(0, 'rgba(84, 160, 255, 0.2)');
    humGrad.addColorStop(1, 'rgba(84, 160, 255, 0.0)');
    
    AppState.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temperatura (°C)',
                    data: tempDataset,
                    borderColor: '#ff4757',
                    backgroundColor: tempGrad,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: labels.length > 50 ? 0 : 2,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#ff4757',
                    yAxisID: 'yTemp'
                },
                {
                    label: 'Umidità (% RH)',
                    data: humDataset,
                    borderColor: '#54a0ff',
                    backgroundColor: humGrad,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: labels.length > 50 ? 0 : 2,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#54a0ff',
                    yAxisID: 'yHum'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#888888',
                        font: {
                            family: 'Inter',
                            size: 11
                        },
                        boxWidth: 15
                    }
                },
                tooltip: {
                    backgroundColor: '#000000',
                    titleColor: '#ffffff',
                    bodyColor: '#cccccc',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    cornerRadius: 0, // Squadrato anche il tooltip
                    padding: 10,
                    titleFont: { family: 'Inter', weight: 'bold' },
                    bodyFont: { family: 'Inter' },
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(1);
                                label += context.datasetIndex === 0 ? ' °C' : ' % RH';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#666666',
                        font: { family: 'Inter', size: 9 },
                        maxTicksLimit: 12
                    }
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        borderColor: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#ff4757',
                        font: { family: 'Inter', size: 10 },
                        callback: value => value.toFixed(0) + ' °C'
                    },
                    title: {
                        display: true,
                        text: 'Temp (°C)',
                        color: '#ff4757',
                        font: { family: 'Inter', size: 10, weight: 'bold' }
                    }
                },
                yHum: {
                    type: 'linear',
                    position: 'right',
                    grid: {
                        drawOnChartArea: false, // evita righe doppie sovrapposte
                        borderColor: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#54a0ff',
                        font: { family: 'Inter', size: 10 },
                        callback: value => value.toFixed(0) + '%'
                    },
                    title: {
                        display: true,
                        text: 'Umidità (% RH)',
                        color: '#54a0ff',
                        font: { family: 'Inter', size: 10, weight: 'bold' }
                    },
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

// ── CALCOLA STATISTICHE PERIODO ──────────────────────────────────
function calculateStats(data) {
    let tSum = 0, hSum = 0;
    let tMin = Infinity, hMin = Infinity;
    let tMax = -Infinity, hMax = -Infinity;
    let tCount = 0, hCount = 0;
    
    data.forEach(item => {
        if (item.temperature !== null) {
            tSum += item.temperature;
            tCount++;
            if (item.temperature < tMin) tMin = item.temperature;
            if (item.temperature > tMax) tMax = item.temperature;
        }
        if (item.humidity !== null) {
            hSum += item.humidity;
            hCount++;
            if (item.humidity < hMin) hMin = item.humidity;
            if (item.humidity > hMax) hMax = item.humidity;
        }
    });
    
    // Temperatura
    DOM.tempMin.textContent = tMin !== Infinity ? `${tMin.toFixed(1)}` : '--.-';
    DOM.tempMax.textContent = tMax !== -Infinity ? `${tMax.toFixed(1)}` : '--.-';
    DOM.tempAvg.textContent = tCount > 0 ? `${(tSum / tCount).toFixed(1)}` : '--.-';
    
    // Umidità
    DOM.humMin.textContent = hMin !== Infinity ? `${hMin.toFixed(1)}` : '--.-';
    DOM.humMax.textContent = hMax !== -Infinity ? `${hMax.toFixed(1)}` : '--.-';
    DOM.humAvg.textContent = hCount > 0 ? `${(hSum / hCount).toFixed(1)}` : '--.-';
}

// ── COMPILA TABELLA DATI RECENTI ──────────────────────────────────
function populateTable(data) {
    // Svuota tabella
    DOM.readingsTableBody.innerHTML = '';
    
    // Prendi le ultime 30 letture e invertile per mostrare le più recenti per prime
    const tableData = [...data].slice(-30).reverse();
    
    tableData.forEach(item => {
        const row = document.createElement('tr');
        
        // Formatta data leggibile
        const dateObj = new Date(item.timestamp);
        const formattedDate = dateObj.toLocaleString('it-IT');
        
        const deviceDisplay = item.sensor_name || item.device_id;
        const tempText = item.temperature !== null ? `${item.temperature.toFixed(1)} °C` : '--';
        const humText = item.humidity !== null ? `${item.humidity.toFixed(1)} %` : '--';
        
        row.innerHTML = `
            <td>${formattedDate}</td>
            <td style="font-weight: 500; color: #ffffff;">${deviceDisplay}</td>
            <td class="text-temp" style="font-family: 'Anton', sans-serif;">${tempText}</td>
            <td class="text-hum" style="font-family: 'Anton', sans-serif;">${humText}</td>
        `;
        
        DOM.readingsTableBody.appendChild(row);
    });
}
