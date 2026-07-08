/* ══════════════════════════════════════════════════════════════════
   OKOPIPI JUNGLE LAB — Climate Monitoring App JavaScript Logic v1.0
   ══════════════════════════════════════════════════════════════════ */

// ── STATO GLOBALE DELL'APPLICAZIONE ───────────────────────────────
const AppState = {
    scriptUrl: localStorage.getItem('okopipi_script_url') || 'https://script.google.com/macros/s/AKfycbzc-kIgOt_VQUXSPHtSJfURo2eUIKB6v63K6V4lB8p4XamvbFhK4bP51bbX9sXc4rxoHA/exec',
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
    setupFeedback: document.getElementById('setupFeedback'),
    btnToggleGuide: document.getElementById('btnToggleGuide'),
    guideSteps: document.getElementById('guideSteps'),
    
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

    // Attiva animazioni premium (pill + scan-line)
    initRangePill();
    initScanLines();
}

// ── EVENT LISTENERS ───────────────────────────────────────────────
function setupEventListeners() {
    // Monitoraggio input per validazione in tempo reale
    DOM.scriptUrlInput.addEventListener('input', () => {
        const url = DOM.scriptUrlInput.value.trim();
        if (!url) {
            DOM.setupFeedback.textContent = '';
            DOM.setupFeedback.className = 'setup-feedback';
            return;
        }
        
        if (url.startsWith('https://script.google.com/')) {
            DOM.setupFeedback.textContent = '✓ Formato URL valido. Pronto per il collegamento.';
            DOM.setupFeedback.className = 'setup-feedback valid';
            DOM.btnSaveUrl.disabled = false;
            DOM.btnSaveUrl.style.opacity = '1';
        } else {
            DOM.setupFeedback.textContent = '✗ La URL deve iniziare con https://script.google.com/';
            DOM.setupFeedback.className = 'setup-feedback invalid';
            DOM.btnSaveUrl.disabled = true;
            DOM.btnSaveUrl.style.opacity = '0.5';
        }
    });

    // Toggle della Guida Passo-Passo (Accordion Animato)
    DOM.btnToggleGuide.addEventListener('click', () => {
        const isExpanded = DOM.btnToggleGuide.classList.contains('active');
        if (isExpanded) {
            DOM.btnToggleGuide.classList.remove('active');
            DOM.guideSteps.style.maxHeight = '0px';
            DOM.guideSteps.style.opacity = '0';
        } else {
            DOM.btnToggleGuide.classList.add('active');
            DOM.guideSteps.style.maxHeight = DOM.guideSteps.scrollHeight + 'px';
            DOM.guideSteps.style.opacity = '1';
        }
    });

    // Connessione con verifica al click
    DOM.btnSaveUrl.addEventListener('click', async () => {
        const url = DOM.scriptUrlInput.value.trim();
        if (!url || !url.startsWith('https://script.google.com/')) {
            DOM.setupFeedback.textContent = '✗ Inserisci una URL valida per procedere.';
            DOM.setupFeedback.className = 'setup-feedback invalid';
            return;
        }
        
        // Stato di caricamento
        DOM.btnSaveUrl.disabled = true;
        DOM.btnSaveUrl.textContent = 'COLLEGAMENTO IN CORSO...';
        DOM.btnSaveUrl.style.opacity = '0.7';
        DOM.setupFeedback.textContent = 'Verifica connessione al foglio Google in corso...';
        DOM.setupFeedback.className = 'setup-feedback';
        
        try {
            // Test GET per verificare che l'endpoint risponda ed esista
            const testUrl = `${url}?range=24h`;
            const response = await fetch(testUrl, { method: 'GET', redirect: 'follow' });
            
            if (!response.ok) {
                throw new Error(`Server ha risposto con codice errore: ${response.status}`);
            }
            
            const testJson = await response.json();
            
            if (testJson.status === 'success') {
                localStorage.setItem('okopipi_script_url', url);
                AppState.scriptUrl = url;
                
                DOM.setupFeedback.textContent = '✓ Connessione stabilita con successo! Caricamento...';
                DOM.setupFeedback.className = 'setup-feedback valid';
                
                // Transizione fluida e avvio
                setTimeout(() => {
                    DOM.btnSaveUrl.disabled = false;
                    DOM.btnSaveUrl.textContent = 'CONNETTI ORA';
                    DOM.btnSaveUrl.style.opacity = '1';
                    initApp();
                }, 1000);
            } else {
                throw new Error(testJson.message || 'La risposta del server non è valida.');
            }
        } catch (error) {
            console.error('Test di connessione fallito:', error);
            DOM.btnSaveUrl.disabled = false;
            DOM.btnSaveUrl.textContent = 'CONNETTI ORA';
            DOM.btnSaveUrl.style.opacity = '1';
            DOM.setupFeedback.textContent = '✗ Connessione fallita. Verifica che la URL sia corretta ed il foglio sia condiviso.';
            DOM.setupFeedback.className = 'setup-feedback invalid';
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

    // Selettore Range Temporale — con pill indicator
    DOM.rangeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            DOM.rangeButtons.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            movePillTo(e.target);
            AppState.activeRange = e.target.getAttribute('data-range');
            fetchData();
        });
    });
}

// ── PILL INDICATOR: SCORRE SOTTO IL BOTTONE ATTIVO ─────────────────
function initRangePill() {
    const pill = document.getElementById('rangePill');
    const rangeSelector = document.getElementById('rangeSelector');
    if (!pill || !rangeSelector) return;

    const activeBtn = rangeSelector.querySelector('.btn-range.active');
    if (activeBtn) {
        // Posiziona la pill immediatamente (senza transizione) all'avvio
        pill.style.transition = 'none';
        movePillTo(activeBtn);
        // Riabilita la transizione dopo il primo frame
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                pill.style.transition = '';
            });
        });
    }
}

function movePillTo(btn) {
    const pill = document.getElementById('rangePill');
    const rangeSelector = document.getElementById('rangeSelector');
    if (!pill || !rangeSelector) return;
    const sRect = rangeSelector.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    pill.style.left  = (bRect.left - sRect.left - 3) + 'px';
    pill.style.width = bRect.width + 'px';
}

// ── SCAN-LINE: EFFETTO "SCANNER" ALL'INGRESSO DELLE CARD ───────────
function initScanLines() {
    // Triggera la scan-line su ogni card scalando i delay
    const cards = document.querySelectorAll('.card');
    const delays = [200, 350, 500, 650, 800, 950, 1100, 1250];
    cards.forEach((card, i) => {
        const delay = delays[i] ?? (200 + i * 140);
        setTimeout(() => {
            card.classList.add('scan-active');
            // Rimuove la classe dopo la fine dell'animazione (1s) per pulizia
            setTimeout(() => card.classList.remove('scan-active'), 1100);
        }, delay);
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

// ── CROSSHAIR PLUGIN: linea verticale tratteggiata al tooltip ───────
const crosshairPlugin = {
    id: 'crosshair',
    afterDraw(chart) {
        if (chart.tooltip._active && chart.tooltip._active.length) {
            const x = chart.tooltip._active[0].element.x;
            const { top, bottom } = chart.chartArea;
            const c = chart.ctx;
            c.save();
            c.beginPath();
            c.moveTo(x, top);
            c.lineTo(x, bottom);
            c.strokeStyle = 'rgba(255,255,255,0.1)';
            c.lineWidth = 1;
            c.setLineDash([4, 4]);
            c.stroke();
            c.restore();
        }
    }
};

// ── DISEGNA IL GRAFICO CLIMATICO (CHART.JS) ─────────────────────
function renderChart(data) {

    if (AppState.chartInstance) {
        AppState.chartInstance.destroy();
    }
    
    const labels = data.map(item => {
        const date = new Date(item.timestamp);
        if (AppState.activeRange === '24h') {
            return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
    });
    
    const tempDataset = data.map(item => item.temperature);
    const humDataset  = data.map(item => item.humidity);
    
    const ctx = DOM.climateChartCanvas.getContext('2d');
    
    // Gradienti area (con mid-stop per effetto più morbido)
    const tempGrad = ctx.createLinearGradient(0, 0, 0, 340);
    tempGrad.addColorStop(0,   'rgba(255, 71, 87, 0.22)');
    tempGrad.addColorStop(0.5, 'rgba(255, 71, 87, 0.06)');
    tempGrad.addColorStop(1,   'rgba(255, 71, 87, 0.0)');
    
    const humGrad = ctx.createLinearGradient(0, 0, 0, 340);
    humGrad.addColorStop(0,   'rgba(84, 160, 255, 0.22)');
    humGrad.addColorStop(0.5, 'rgba(84, 160, 255, 0.06)');
    humGrad.addColorStop(1,   'rgba(84, 160, 255, 0.0)');

    // Durata disegno punto per punto da sinistra (~1.4s totali)
    const drawDuration = 1400;
    const dpDelay = drawDuration / Math.max(labels.length, 1);
    
    AppState.chartInstance = new Chart(ctx, {
        type: 'line',
        plugins: [crosshairPlugin],
        data: {
            labels,
            datasets: [
                {
                    label: 'Temperatura (°C)',
                    data: tempDataset,
                    borderColor: '#ff4757',
                    backgroundColor: tempGrad,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.42,
                    pointRadius: labels.length > 50 ? 0 : 3,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#000',
                    pointBorderColor: '#ff4757',
                    pointBorderWidth: 2,
                    yAxisID: 'yTemp'
                },
                {
                    label: 'Umidità (% RH)',
                    data: humDataset,
                    borderColor: '#54a0ff',
                    backgroundColor: humGrad,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.42,
                    pointRadius: labels.length > 50 ? 0 : 3,
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#000',
                    pointBorderColor: '#54a0ff',
                    pointBorderWidth: 2,
                    yAxisID: 'yHum'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // Animazione: disegno da sinistra punto per punto
            animation: {
                x: {
                    type: 'number', easing: 'easeOutQuart',
                    duration: dpDelay, from: NaN,
                    delay(ctx) {
                        if (ctx.type !== 'data' || ctx.xStarted) return 0;
                        ctx.xStarted = true;
                        return ctx.index * dpDelay;
                    }
                },
                y: {
                    type: 'number', easing: 'easeOutQuart',
                    duration: dpDelay, from: NaN,
                    delay(ctx) {
                        if (ctx.type !== 'data' || ctx.yStarted) return 0;
                        ctx.yStarted = true;
                        return ctx.index * dpDelay;
                    }
                }
            },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#666',
                        font: { family: 'Inter', size: 10, weight: 600 },
                        boxWidth: 12,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(2,2,2,0.96)',
                    titleColor: '#ffffff',
                    bodyColor: '#999999',
                    borderColor: 'rgba(255,255,255,0.09)',
                    borderWidth: 1,
                    cornerRadius: 0,
                    padding: 12,
                    titleFont: { family: 'Inter', weight: '700', size: 12 },
                    bodyFont:  { family: 'Inter', size: 11 },
                    callbacks: {
                        label(context) {
                            const v = context.parsed.y !== null ? context.parsed.y.toFixed(1) : '--';
                            return context.datasetIndex === 0
                                ? `  Temperatura:  ${v} °C`
                                : `  Umidità:      ${v} % RH`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.025)', drawBorder: false },
                    ticks: { color: '#555', font: { family: 'Inter', size: 9 }, maxTicksLimit: 12 }
                },
                yTemp: {
                    type: 'linear', position: 'left',
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                    ticks: {
                        color: 'rgba(255,71,87,0.8)',
                        font: { family: 'Inter', size: 10 },
                        callback: v => v.toFixed(0) + ' °C'
                    },
                    title: {
                        display: true, text: 'Temp (°C)',
                        color: 'rgba(255,71,87,0.6)',
                        font: { family: 'Inter', size: 10, weight: 'bold' }
                    }
                },
                yHum: {
                    type: 'linear', position: 'right',
                    grid: { drawOnChartArea: false, drawBorder: false },
                    ticks: {
                        color: 'rgba(84,160,255,0.8)',
                        font: { family: 'Inter', size: 10 },
                        callback: v => v.toFixed(0) + '%'
                    },
                    title: {
                        display: true, text: 'Umidità (% RH)',
                        color: 'rgba(84,160,255,0.6)',
                        font: { family: 'Inter', size: 10, weight: 'bold' }
                    },
                    min: 0, max: 100
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
