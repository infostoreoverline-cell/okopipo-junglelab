/*
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║     TERMOIGROMETRO ESP8266 — TEST/MOCK VERSION (NO SENSOR)      ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  MCU      : ESP8266 (ESP-12F / NodeMCU)                         ║
 * ║  Sensore  : NESSUNO (Simulazione interna di Temperatura/Umidità) ║
 * ║  Display  : SSD1306 0.96" OLED — I2C su D5 (SDA=14) e D6(12)  ║
 * ║  Storage  : LittleFS (Flash interna)                             ║
 * ║  REQUISITO HW: collegare GPIO16 (D0) a RST per il wake-up       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *  ATTIVAZIONE SCHERMO MANUALE: doppio click sul tasto RESET
 *  entro 1.5 secondi dall'avvio (durante la finestra di standby).
 */

// ─── §0  DEBUG ───────────────────────────────────────────────────────────────
#define DEBUG

#ifdef DEBUG
#define DBG_BEGIN(b)    do { Serial.begin(b); delay(10); } while (0)
#define DBG_PRINT(x)    Serial.print(x)
#define DBG_PRINTLN(x)  Serial.println(x)
#define DBG_PRINTF(...) Serial.printf(__VA_ARGS__)
#else
#define DBG_BEGIN(b)
#define DBG_PRINT(x)
#define DBG_PRINTLN(x)
#define DBG_PRINTF(...)
#endif

// ─── §1  LIBRERIE ─────────────────────────────────────────────────────────────
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <LittleFS.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>  // Libreria per la configurazione Wi-Fi dinamica (tzapu)
#include <Wire.h>
#include <user_interface.h>

ADC_MODE(ADC_VCC);


// ─── §2  CONFIGURAZIONE ───────────────────────────────────────────────────────
// Inserisci la URL della tua Web App Google Apps Script
static const char HTTP_EP[]   PROGMEM = "https://script.google.com/macros/s/AKfycbyRDURF4GQMy5dC9_0LdXAObEXHyYUvm6HR1qFAVTFgWLHl9LL9NOZCI3hToTnqWIvwzQ/exec";
static const char DATA_FILE[] PROGMEM = "/dati.txt";

static constexpr uint8_t  PIN_SDA_OLED      = 14;    // D5 — SDA OLED interno
static constexpr uint8_t  PIN_SCL_OLED      = 12;    // D6 — SCL OLED interno
static constexpr uint8_t  DISP_PRI          = 0x3C;
static constexpr uint8_t  DISP_FALL         = 0x3D;
static constexpr uint8_t  SCREEN_W          = 128;
static constexpr uint8_t  SCREEN_H          = 64;
static constexpr uint64_t SLEEP_US          = 60ULL * 1000000ULL;  // 60 secondi (1 minuto)
static constexpr uint32_t READINGS_PER_SEND = 60;                  // Invia ogni 60 misure = 1 ora
static constexpr uint32_t FS_MAX_BYTES      = 65536UL;
static constexpr uint32_t DISPLAY_WIN_MS    = 2000UL;  // Finestra doppio reset (ms)

// Comandi SSD1306 per spegnimento charge pump
static constexpr uint8_t CMD_CHARGEPUMP = 0x8D;
static constexpr uint8_t CMD_PUMP_OFF   = 0x10;
static constexpr uint8_t CMD_DISPLAYOFF = 0xAE;

// ─── §3  STRUTTURA RTC ────────────────────────────────────────────────────────
struct __attribute__((packed)) RtcCounter {
  uint32_t crc32;
  uint32_t counter;
};
static_assert(sizeof(RtcCounter) <= 8, "RtcCounter troppo grande");
static RtcCounter rtcCounter;

// Flag per il double-reset — RAM RTC
static constexpr uint8_t  RTC_FLAG_OFFSET = 2;        // in unità di uint32_t
static uint32_t rtcFlagWord = 0;
static constexpr uint32_t MAGIC_AWAIT    = 0xD0B1E55;

// Flag per la preparazione della radio (reboot RF_DEFAULT) — offset 3.
static constexpr uint8_t  RTC_RF_OFFSET = 3;
static uint32_t rtcRfPrepared = 0;

// ─── §4  OGGETTI GLOBALI ──────────────────────────────────────────────────────
static Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1);

// =============================================================================
//  UTILITA  CRC & RTC
// =============================================================================
static uint32_t calcCRC32(const uint8_t *d, size_t n) {
  uint32_t crc = 0xFFFFFFFFu;
  while (n--) {
    uint8_t b = *d++;
    for (uint8_t i = 8; i; --i, b >>= 1)
      crc = ((crc ^ b) & 1u) ? (crc >> 1) ^ 0xEDB88320u : (crc >> 1);
  }
  return ~crc;
}

static bool readRTC() {
  ESP.rtcUserMemoryRead(0, reinterpret_cast<uint32_t *>(&rtcCounter), sizeof(rtcCounter));
  const uint8_t *payload = reinterpret_cast<const uint8_t *>(&rtcCounter.counter);
  return calcCRC32(payload, sizeof(rtcCounter.counter)) == rtcCounter.crc32;
}

static void writeRTC() {
  const uint8_t *payload = reinterpret_cast<const uint8_t *>(&rtcCounter.counter);
  rtcCounter.crc32 = calcCRC32(payload, sizeof(rtcCounter.counter));
  ESP.rtcUserMemoryWrite(0, reinterpret_cast<uint32_t *>(&rtcCounter), sizeof(rtcCounter));
}

static void readRTCFlag() {
  ESP.rtcUserMemoryRead(RTC_FLAG_OFFSET, &rtcFlagWord, sizeof(rtcFlagWord));
}

static void writeRTCFlag(uint32_t value) {
  rtcFlagWord = value;
  ESP.rtcUserMemoryWrite(RTC_FLAG_OFFSET, &rtcFlagWord, sizeof(rtcFlagWord));
}

static void readRTCRfPrepared() {
  ESP.rtcUserMemoryRead(RTC_RF_OFFSET, &rtcRfPrepared, sizeof(rtcRfPrepared));
}

static void writeRTCRfPrepared(uint32_t value) {
  rtcRfPrepared = value;
  ESP.rtcUserMemoryWrite(RTC_RF_OFFSET, &rtcRfPrepared, sizeof(rtcRfPrepared));
}

static inline bool isDeepSleepWake() {
  return ESP.getResetInfoPtr()->reason == REASON_DEEP_SLEEP_AWAKE;
}

static inline void wifiOff() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

// =============================================================================
//  LETTURA SENSORE SIMULATA (MOCK)
// =============================================================================
static bool readSensor(int16_t &t10, int16_t &h10) {
  // Simulazione valori per test senza sonda fisica
  // Genera un valore base a cui aggiunge un po' di variazione casuale (noise)
  randomSeed(micros());
  float simulatedTemp = 24.5f + (random(-20, 20) / 10.0f); // Range 22.5 - 26.5 °C
  float simulatedHum = 60.0f + (random(-60, 60) / 10.0f);   // Range 54.0 - 66.0 %
  
  t10 = static_cast<int16_t>(simulatedTemp * 10.0f);
  h10 = static_cast<int16_t>(simulatedHum * 10.0f);
  
  DBG_PRINTF("[MOCK SENSOR] T=%d.%d C  H=%d.%d%%\n", t10/10, t10%10, h10/10, h10%10);
  return true; // Ritorna sempre successo
}

// =============================================================================
//  DATA LOGGING SU LITTLEFS
// =============================================================================
static void saveMeasurement(int16_t t10, int16_t h10) {
  if (!LittleFS.begin()) { DBG_PRINTLN(F("[FS] ERR: mount")); return; }
  File f = LittleFS.open(FPSTR(DATA_FILE), "a");
  if (!f) { DBG_PRINTLN(F("[FS] ERR: open")); LittleFS.end(); return; }

  if (f.size() < FS_MAX_BYTES) {
    f.print(t10); f.print(','); f.println(h10);
    DBG_PRINTF("[FS] Dato simulato accodato (file: %u byte)\n", (unsigned)f.size());
  } else {
    DBG_PRINTLN(F("[FS] WARN: file pieno, dato scartato"));
  }
  f.close();
  LittleFS.end();
}

// =============================================================================
//  TRASMISSIONE WI-FI CON WIFIMANAGER DINAMICO
// =============================================================================
static void sendWiFiData() {
  DBG_PRINTLN(F("[WiFi] Avvio connessione dinamica..."));
  
  WiFiManager wifiManager;

  // Genera SSID unico usando il MAC address dell'ESP8266
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  String apName = "Okopipi_" + mac.substring(6); // es. "Okopipi_DDEEFF"

  // Timeout portale a 120s per evitare battery-drain se la config fallisce
  wifiManager.setConfigPortalTimeout(120);

  // Avvia il portale di configurazione se non si connette alle credenziali salvate
  if (!wifiManager.autoConnect(apName.c_str())) {
    DBG_PRINTLN(F("[WiFi] Timeout portale o errore connessione — dati conservati"));
    wifiOff(); return;
  }
  
  DBG_PRINTLN(F("[WiFi] Connesso!"));

  if (!LittleFS.begin()) { DBG_PRINTLN(F("[FS] ERR: mount per invio")); wifiOff(); return; }

  File f = LittleFS.open(FPSTR(DATA_FILE), "r");
  if (!f || f.size() == 0) {
    DBG_PRINTLN(F("[FS] Nessun dato da inviare"));
    if (f) f.close();
    LittleFS.end(); wifiOff(); return;
  }
  DBG_PRINTF("[WiFi] Invio %u byte di dati...\n", (unsigned)f.size());

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  bool sendOk = false;

  // Aggiungiamo device_id al query parameter perché Google Apps Script non legge gli header personalizzati
  String targetEp = String(FPSTR(HTTP_EP)) + "?device_id=" + WiFi.macAddress();

  if (http.begin(client, targetEp)) {
    http.addHeader(F("Content-Type"), F("text/csv"));
    http.setTimeout(8000);
    const int code = http.sendRequest("POST", &f, f.size());
    DBG_PRINTF("[HTTP] Risposta: %d\n", code);
    sendOk = (code >= 200 && code < 300);
    http.end();
  } else {
    DBG_PRINTLN(F("[HTTP] ERR: begin()"));
  }

  f.close();
  LittleFS.end();

  if (sendOk) {
    LittleFS.begin();
    LittleFS.remove(FPSTR(DATA_FILE));
    LittleFS.end();
    rtcCounter.counter = 0;
    writeRTC();
    writeRTCRfPrepared(0);
    DBG_PRINTLN(F("[WiFi] OK — file eliminato, counter azzerato"));
  } else {
    DBG_PRINTLN(F("[WiFi] FAIL — dati conservati per prossimo invio"));
  }

  wifiOff();
}

// =============================================================================
//  DISPLAY DATI SIMULATI LIVE — Aggiorna ogni secondo
// =============================================================================
static void runDisplayCycle(uint32_t durationMs = 10000UL) {
  Wire.begin(PIN_SDA_OLED, PIN_SCL_OLED);
  if (!display.begin(SSD1306_SWITCHCAPVCC, DISP_PRI) &&
      !display.begin(SSD1306_SWITCHCAPVCC, DISP_FALL)) {
    DBG_PRINTLN(F("[OLED] ERR: init fallita")); return;
  }

  DBG_PRINTF("[OLED] Avvio ciclo display %lu ms\n", durationMs);
  uint32_t t0 = millis();
  while (millis() - t0 < durationMs) {
    int16_t t10 = 0, h10 = 0;
    if (readSensor(t10, h10)) {
      Wire.begin(PIN_SDA_OLED, PIN_SCL_OLED);
      display.clearDisplay();

      // HEADER (Zona Gialla)
      display.fillRect(0, 0, 128, 16, SSD1306_WHITE);
      display.setTextColor(SSD1306_BLACK);
      display.setTextSize(1);
      display.setCursor(18, 4);
      display.print(F("CLIMA SIMULATO")); // Indicatore simulazione

      // Icona Batteria
      display.drawRect(110, 4, 15, 8, SSD1306_BLACK);
      display.fillRect(125, 6, 2, 4, SSD1306_BLACK);
      display.fillRect(112, 6, 11, 4, SSD1306_BLACK); // Carica fissa per test

      // DATI (Zona Azzurra)
      display.setTextColor(SSD1306_WHITE);

      char tempStr[10];
      char humStr[10];

      sprintf(tempStr, "%d.%d\xF8" "C", t10 / 10, t10 % 10);
      sprintf(humStr, "%d.%d%% RH", h10 / 10, h10 % 10);

      // Temperatura
      display.setTextSize(3);
      int tempWidth = strlen(tempStr) * 18;
      display.setCursor((128 - tempWidth) / 2, 22);
      display.print(tempStr);

      // Umidità
      display.setTextSize(2);
      int humWidth = strlen(humStr) * 12;
      display.setCursor((128 - humWidth) / 2, 48);
      display.print(humStr);

      display.display();
    }

    uint32_t delayStart = millis();
    while (millis() - delayStart < 1000UL) {
      yield();
    }
  }

  // Spegni lo schermo
  display.ssd1306_command(CMD_CHARGEPUMP);
  display.ssd1306_command(CMD_PUMP_OFF);
  display.ssd1306_command(CMD_DISPLAYOFF);
}

// =============================================================================
//  SETUP E LOOP
// =============================================================================
void setup() {
  WiFi.mode(WIFI_OFF);
  WiFi.forceSleepBegin();

  DBG_BEGIN(115200);
  DBG_PRINTLN(F("\n[BOOT TEST] Termoigrometro MOCK ESP8266 v2.0"));

  if (!readRTC()) {
    rtcCounter.counter = 0;
    writeRTC();
  }
  if (rtcCounter.counter > 10000u) rtcCounter.counter = READINGS_PER_SEND;
  DBG_PRINTF("[RTC] Contatore: %lu / %u\n", rtcCounter.counter, READINGS_PER_SEND);

  readRTCFlag();
  readRTCRfPrepared();

  const bool autoWake = isDeepSleepWake();
  if (!autoWake && rtcRfPrepared != 0) {
    writeRTCRfPrepared(0);
  }
  
  bool manualOverride = false;
  if (rtcFlagWord == MAGIC_AWAIT) {
    DBG_PRINTLN(F("[BOOT] *** Double-Reset! Attivo display 10s ***"));
    manualOverride = true;
    writeRTCFlag(0);
  }

  int16_t t10, h10;
  readSensor(t10, h10); // Genera la lettura simulata (ritorna sempre true)

  if (!manualOverride) {
    if (autoWake) {
      writeRTCFlag(MAGIC_AWAIT);
      const uint32_t t_win = millis();
      while (millis() - t_win < DISPLAY_WIN_MS) {
        yield();
      }
      writeRTCFlag(0);
    }

    // Salva misura simulata nel database LittleFS
    saveMeasurement(t10, h10);
    ++rtcCounter.counter;
    writeRTC();

    if (autoWake) {
      if (rtcCounter.counter >= READINGS_PER_SEND) {
        if (rtcRfPrepared == 1) {
          writeRTCRfPrepared(0);
          WiFi.forceSleepWake();
          delay(1);
          sendWiFiData();
        } else {
          writeRTCRfPrepared(1);
          ESP.deepSleep(10000ULL, WAKE_RF_DEFAULT);
          return;
        }
      } else {
        if (rtcRfPrepared != 0) writeRTCRfPrepared(0);
      }
    } else {
      runDisplayCycle(10000UL);
      WiFi.forceSleepWake();
      delay(1);
      sendWiFiData();
    }
  } else {
    runDisplayCycle(10000UL);
    WiFi.forceSleepWake();
    delay(1);
    sendWiFiData();
  }

  uint32_t elapsedMs = millis();
  uint32_t sleepMs = SLEEP_US / 1000ULL;
  uint64_t actualSleepUs;
  if (elapsedMs < sleepMs) {
    actualSleepUs = (sleepMs - elapsedMs) * 1000ULL;
  } else {
    actualSleepUs = 1000000ULL;
  }

  DBG_PRINTF("[BOOT] → deepSleep %llu s\n", actualSleepUs / 1000000ULL);
  ESP.deepSleep(actualSleepUs, WAKE_RF_DISABLED);
}

void loop() { ESP.deepSleep(SLEEP_US, WAKE_RF_DISABLED); }
