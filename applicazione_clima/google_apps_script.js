// ╔══════════════════════════════════════════════════════════════════╗
// ║  OKOPIPI JUNGLE LAB — Google Apps Script Climate Backend V1.0     ║
// ║                                                                  ║
// ║  Architettura:                                                   ║
// ║    • Auto-creazione fogli e intestazioni alla prima esecuzione    ║
// ║    • Ingestione dati da ESP8266: supporta sia JSON che CSV        ║
// ║    • Gestione del timestamp a ritroso per batch di letture        ║
// ║    • Auto-registrazione dei sensori sconosciuti                   ║
// ║    • Servizio GET con filtri temporali (24h, 7gg, 30gg, Tutto)    ║
// ╚══════════════════════════════════════════════════════════════════╝

// ══════════════════════════════════════════════════════════════
// CONFIGURAZIONE GLOBALE
// ══════════════════════════════════════════════════════════════

// I fogli e le intestazioni rigide
var SHEET_NAMES = {
  DATI: 'DatiClima',
  SENSORI: 'Sensori'
};

var SCHEMAS = {
  DatiClima: [
    'Timestamp',
    'DeviceID',
    'Temperature',
    'Humidity'
  ],
  Sensori: [
    'DeviceID',
    'Nome'
  ]
};

// ══════════════════════════════════════════════════════════════
// UTILITY: JSON Response Builder
// ══════════════════════════════════════════════════════════════
function buildJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════
// UTILITY: Inizializza intestazioni e fogli
// ══════════════════════════════════════════════════════════════
function ensureHeaders(ss, sheetName) {
  var schema = SCHEMAS[sheetName];
  if (!schema) return;
  
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(schema);
    // Formatta l'intestazione in stile Okopipi (sfondo nero, testo bianco bold)
    var headerRange = sheet.getRange(1, 1, 1, schema.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#000000');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
}

// Inizializza i fogli (può essere eseguita manualmente dal menu Apps Script)
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeaders(ss, SHEET_NAMES.DATI);
  ensureHeaders(ss, SHEET_NAMES.SENSORI);
  Logger.log('Inizializzazione completata. Fogli creati con successo.');
}

// ══════════════════════════════════════════════════════════════
// ENDPOINT: doGet (Fornisce i dati alla pagina web)
// ══════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureHeaders(ss, SHEET_NAMES.DATI);
    ensureHeaders(ss, SHEET_NAMES.SENSORI);
    
    var datiSheet = ss.getSheetByName(SHEET_NAMES.DATI);
    var sensoriSheet = ss.getSheetByName(SHEET_NAMES.SENSORI);
    
    // Leggi l'anagrafica dei sensori per mapparli nel JSON
    var sensoriMappa = {};
    if (sensoriSheet.getLastRow() > 1) {
      var sensoriDati = sensoriSheet.getRange(2, 1, sensoriSheet.getLastRow() - 1, 2).getValues();
      for (var s = 0; s < sensoriDati.length; s++) {
        var devId = String(sensoriDati[s][0]).trim();
        var nome = String(sensoriDati[s][1]).trim();
        if (devId) {
          sensoriMappa[devId] = nome || devId;
        }
      }
    }
    
    // Parametro per il filtro temporale: ?range=24h, 7d, 30d, all
    var range = (e && e.parameter && e.parameter.range) ? String(e.parameter.range).trim() : '7d';
    
    var limitMs = 0;
    var now = Date.now();
    if (range === '24h') {
      limitMs = now - (24 * 60 * 60 * 1000);
    } else if (range === '7d') {
      limitMs = now - (7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      limitMs = now - (30 * 24 * 60 * 60 * 1000);
    } // 'all' mantiene limitMs = 0
    
    var risultati = [];
    if (datiSheet.getLastRow() > 1) {
      var headers = datiSheet.getRange(1, 1, 1, 4).getValues()[0];
      var rawValues = datiSheet.getRange(2, 1, datiSheet.getLastRow() - 1, 4).getValues();
      
      for (var r = 0; r < rawValues.length; r++) {
        var row = rawValues[r];
        var timestampStr = row[0];
        var deviceId = String(row[1]).trim();
        var temperature = parseFloat(row[2]);
        var humidity = parseFloat(row[3]);
        
        // Calcola millisecondi del timestamp
        var timestampMs = 0;
        if (timestampStr instanceof Date) {
          timestampMs = timestampStr.getTime();
        } else {
          timestampMs = Date.parse(timestampStr);
        }
        
        // Applica il filtro temporale
        if (limitMs > 0 && timestampMs < limitMs) {
          continue;
        }
        
        // Formatta la data in ISO
        var dateObj = new Date(timestampMs);
        var isoString = Utilities.formatDate(dateObj, "Europe/Rome", "yyyy-MM-dd'T'HH:mm:ss");
        
        risultati.push({
          timestamp: isoString,
          device_id: deviceId,
          sensor_name: sensoriMappa[deviceId] || deviceId,
          temperature: isNaN(temperature) ? null : temperature,
          humidity: isNaN(humidity) ? null : humidity
        });
      }
    }
    
    // Ordina i dati cronologicamente
    risultati.sort(function(a, b) {
      return Date.parse(a.timestamp) - Date.parse(b.timestamp);
    });
    
    return buildJsonResponse({
      status: 'success',
      range: range,
      count: risultati.length,
      sensors: sensoriMappa,
      data: risultati
    });
    
  } catch (err) {
    return buildJsonResponse({
      status: 'error',
      message: err.toString()
    });
  }
}

// ══════════════════════════════════════════════════════════════
// ENDPOINT: doPost (Riceve le letture dall'ESP8266)
// ══════════════════════════════════════════════════════════════
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Attendi fino a 15 secondi per serializzare le scritture ed evitare conflitti
    lock.waitLock(15000);
  } catch (lockErr) {
    return buildJsonResponse({
      status: 'error',
      message: 'Server occupato. Riprova più tardi.'
    });
  }
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureHeaders(ss, SHEET_NAMES.DATI);
    ensureHeaders(ss, SHEET_NAMES.SENSORI);
    
    var datiSheet = ss.getSheetByName(SHEET_NAMES.DATI);
    var sensoriSheet = ss.getSheetByName(SHEET_NAMES.SENSORI);
    
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Nessun dato ricevuto nel body del POST.');
    }
    
    var contents = e.postData.contents;
    var contentType = e.postData.type || '';
    
    var deviceId = 'unknown';
    var readings = [];
    
    // 1. DETERMINAZIONE DEL FORMATO (JSON o CSV)
    if (contentType.indexOf('application/json') >= 0 || contents.trim().startsWith('{')) {
      // Formato JSON (es. inoltro da server proxy Vercel o webhook)
      var datiJson = JSON.parse(contents);
      deviceId = datiJson.device_id || deviceId;
      
      if (datiJson.readings && Array.isArray(datiJson.readings)) {
        for (var i = 0; i < datiJson.readings.length; i++) {
          var r = datiJson.readings[i];
          readings.push({
            t10: parseInt(r.t10, 10),
            h10: parseInt(r.h10, 10)
          });
        }
      } else if (datiJson.t10 !== undefined && datiJson.h10 !== undefined) {
        // Lettura singola diretta JSON
        readings.push({
          t10: parseInt(datiJson.t10, 10),
          h10: parseInt(datiJson.h10, 10)
        });
      }
    } else {
      // Formato CSV (inviato direttamente dall'ESP8266)
      // Esempio:
      // 245,582
      // 246,585
      // Dal momento che GAS non legge gli header personalizzati (es. X-Device-ID),
      // il deviceId deve essere passato come query parameter: ?device_id=MAC
      if (e.parameter && e.parameter.device_id) {
        deviceId = String(e.parameter.device_id).trim();
      } else if (e.parameter && e.parameter.deviceId) {
        deviceId = String(e.parameter.deviceId).trim();
      }
      
      var lines = contents.split(/\r?\n/);
      for (var l = 0; l < lines.length; l++) {
        var line = lines[l].trim();
        if (!line) continue;
        var parts = line.split(',');
        if (parts.length >= 2) {
          var tVal = parseInt(parts[0], 10);
          var hVal = parseInt(parts[1], 10);
          if (!isNaN(tVal) && !isNaN(hVal)) {
            readings.push({ t10: tVal, h10: hVal });
          }
        }
      }
    }
    
    if (readings.length === 0) {
      throw new Error('Nessuna lettura valida trovata nel payload.');
    }
    
    // 2. AUTO-REGISTRAZIONE DEL SENSORE NELL'ANAGRAFICA
    if (deviceId !== 'unknown') {
      var sensoriDati = sensoriSheet.getLastRow() > 1 
        ? sensoriSheet.getRange(2, 1, sensoriSheet.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0]).trim().toLowerCase(); }) 
        : [];
      
      if (sensoriDati.indexOf(deviceId.toLowerCase()) === -1) {
        sensoriSheet.appendRow([
          deviceId,
          'Nuovo Terrario (' + deviceId + ')'
        ]);
      }
    }
    
    // 3. GENERAZIONE TIMESTAMPS A RITROSO (60 secondi l'uno)
    var nowMs = Date.now();
    var INTERVAL_MS = 60 * 1000; // Intervallo standard di 60s
    var totalReadings = readings.length;
    var batchRows = [];
    
    for (var j = 0; j < totalReadings; j++) {
      var reading = readings[j];
      var tempC = reading.t10 / 10.0;
      var humPct = reading.h10 / 10.0;
      
      // Controllo di validità dei sensori SHT40
      if (tempC < -40 || tempC > 125 || humPct < 0 || humPct > 100) {
        continue; // Scarta letture corrotte/fuori range
      }
      
      // Calcola il timestamp relativo a ritroso
      // i = 0 è il più vecchio (ora - (N-1)*60s), i = N-1 è il più recente (ora)
      var readingMs = nowMs - (totalReadings - 1 - j) * INTERVAL_MS;
      var readingIso = Utilities.formatDate(
        new Date(readingMs),
        "Europe/Rome",
        "yyyy-MM-dd'T'HH:mm:ss"
      );
      
      batchRows.push([
        readingIso,
        deviceId,
        tempC,
        humPct
      ]);
    }
    
    if (batchRows.length > 0) {
      var startRow = datiSheet.getLastRow() + 1;
      datiSheet.getRange(startRow, 1, batchRows.length, 4).setValues(batchRows);
    }
    
    return buildJsonResponse({
      status: 'success',
      device_id: deviceId,
      written: batchRows.length,
      discarded: totalReadings - batchRows.length
    });
    
  } catch (err) {
    return buildJsonResponse({
      status: 'error',
      message: err.toString()
    });
  } finally {
    lock.releaseLock();
  }
}
