#include <Arduino.h>
#include <driver/rtc_io.h>
#include "LEDHandler.h"
#include "Config.h"
#include "Audio.h"
#include "SPIFFS.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp_wifi.h>
#include <esp_netif_sta_list.h>
#include <driver/touch_sensor.h>
#include "Button.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// #define WEBSOCKETS_DEBUG_LEVEL WEBSOCKETS_LEVEL_ALL

#define TOUCH_THRESHOLD 22500
#define SLEEP_THRESHOLD 1000
#define REQUIRED_RELEASE_CHECKS 100     // how many consecutive times we need "below threshold" to confirm release
#define TOUCH_DEBOUNCE_DELAY 500 // milliseconds

esp_err_t getErr = ESP_OK;


// Main Thread -> onButtonLongPressUpEventCb -> enterSleep()
// Main Thread -> onButtonDoubleClickCb -> enterSleep()
// Touch Task -> touchTask -> enterSleep()
// Main Thread -> loop() (inactivity timeout) -> enterSleep()
void enterSleep()
{
    Serial.println("Going to sleep...");
    
    // First, change device state to prevent any new data processing
    deviceState = SLEEP;

    scheduleListeningRestart = false;
    i2sOutputFlushScheduled = true;
    i2sInputFlushScheduled = true;
    vTaskDelay(10);  //let all tasks accept state

    xSemaphoreTake(wsMutex, portMAX_DELAY);

    // Stop audio tasks first
    i2s_stop(I2S_PORT_IN);
    i2s_stop(I2S_PORT_OUT);

    // Properly disconnect WebSocket and wait for it to complete
    if (webSocket.isConnected()) {
        webSocket.disconnect();
        // Give some time for the disconnect to process
        delay(100);
    }

    xSemaphoreGive(wsMutex);
    delay(100);
    
    // Stop all tasks that might be using I2S or other peripherals
    i2s_driver_uninstall(I2S_PORT_IN);
    i2s_driver_uninstall(I2S_PORT_OUT);
    
    // Flush any remaining serial output
    Serial.flush();

    #ifdef TOUCH_MODE
        touch_pad_intr_disable(TOUCH_PAD_INTR_MASK_ALL);
        while (touchRead(TOUCH_PAD_NUM2) > TOUCH_THRESHOLD) {
        delay(50);
        }
        delay(500);
        touchSleepWakeUpEnable(TOUCH_PAD_NUM2, SLEEP_THRESHOLD);
    #endif

    esp_deep_sleep_start();
    delay(1000);
}

void processSleepRequest() {
    if (sleepRequested) {
        sleepRequested = false;
        enterSleep(); 
    }
}

void printOutESP32Error(esp_err_t err)
{
    switch (err)
    {
    case ESP_OK:
        Serial.println("ESP_OK no errors");
        break;
    case ESP_ERR_INVALID_ARG:
        Serial.println("ESP_ERR_INVALID_ARG if the selected GPIO is not an RTC GPIO, or the mode is invalid");
        break;
    case ESP_ERR_INVALID_STATE:
        Serial.println("ESP_ERR_INVALID_STATE if wakeup triggers conflict or wireless not stopped");
        break;
    default:
        Serial.printf("Unknown error code: %d\n", err);
        break;
    }
}

static void onButtonLongPressUpEventCb(void *button_handle, void *usr_data)
{
    Serial.println("Button long press end");
    delay(10);
    sleepRequested = true;
}

static void onButtonDoubleClickCb(void *button_handle, void *usr_data)
{
    Serial.println("Button double click");
    delay(10);
    sleepRequested = true;
}

void getAuthTokenFromNVS()
{
    preferences.begin("auth", false);
    authTokenGlobal = preferences.getString("auth_token", "");
    preferences.end();
}

static void sendInterruptInstruction()
{
    static const char *interruptMessage = "{\"type\":\"instruction\",\"msg\":\"INTERRUPT\"}";

    xSemaphoreTake(wsMutex, portMAX_DELAY);
    if (webSocket.isConnected()) {
        webSocket.sendTXT(interruptMessage);
    }
    xSemaphoreGive(wsMutex);
}

static bool getFirstApStationIp(IPAddress &stationIp)
{
    wifi_sta_list_t wifiStaList;
    esp_netif_sta_list_t netifStaList;

    if (esp_wifi_ap_get_sta_list(&wifiStaList) != ESP_OK || wifiStaList.num == 0) {
        return false;
    }

    if (esp_netif_get_sta_list(&wifiStaList, &netifStaList) != ESP_OK || netifStaList.num == 0) {
        return false;
    }

    stationIp = IPAddress(netifStaList.sta[0].ip.addr);
    return true;
}

static bool serverReachable(const String &serverIp, uint16_t port)
{
    WiFiClient probe;
    bool ok = probe.connect(serverIp.c_str(), port, 500);
    if (ok) {
        probe.stop();
    }
    return ok;
}

static bool findReachableServerPort(const String &serverIp, uint16_t &port)
{
    const uint16_t candidatePorts[] = {49320, 8000};

    for (uint16_t candidatePort : candidatePorts) {
        if (serverReachable(serverIp, candidatePort)) {
            port = candidatePort;
            return true;
        }
    }

    return false;
}

void wifiStationTask(void *parameter)
{
    String connectedServerIp = "";
    uint16_t connectedServerPort = 0;

    while (1) {
        IPAddress stationIp;
        if (getFirstApStationIp(stationIp)) {
            apStationConnected = true;

            String stationIpString = stationIp.toString();
            uint16_t reachablePort = 0;

            if (findReachableServerPort(stationIpString, reachablePort)) {
                if (stationIpString != connectedServerIp || reachablePort != connectedServerPort || !webSocket.isConnected()) {
                    connectedServerIp = stationIpString;
                    connectedServerPort = reachablePort;
                    ws_server_ip = stationIpString;
                    // Stay "connecting" (pink) until the websocket actually opens;
                    // WStype_CONNECTED is what turns the LED white (AP_CONNECTED).
                    deviceState = SOFT_AP;

                    Serial.printf("[WIFI] Mac joined ELATO at %s\n", ws_server_ip.c_str());
                    Serial.printf("[WIFI] Connecting websocket client to ws://%s:%u%s\n",
                                  ws_server_ip.c_str(),
                                  connectedServerPort,
                                  ws_path);

                    websocketSetup(ws_server_ip, connectedServerPort, ws_path);
                }
            } else {
                deviceState = SOFT_AP;
                Serial.printf("[WIFI] Waiting for app server on %s ports 49320/8000\n", stationIpString.c_str());
            }
        } else if (connectedServerIp.length() > 0) {
            Serial.println("[WIFI] Mac left ELATO; waiting for it to rejoin");
            apStationConnected = false;
            connectedServerIp = "";
            connectedServerPort = 0;
            ws_server_ip = "";
            deviceState = SOFT_AP;
        } else {
            apStationConnected = false;
            deviceState = SOFT_AP;
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void setupWiFi()
{
    WiFi.mode(WIFI_AP);
    WiFi.setSleep(false);

    IPAddress apIp(192, 168, 4, 1);
    IPAddress gateway(192, 168, 4, 1);
    IPAddress subnet(255, 255, 255, 0);
    if (!WiFi.softAPConfig(apIp, gateway, subnet)) {
        Serial.println("[WIFI] Failed to configure ELATO AP network");
    }

    if (!WiFi.softAP(ap_ssid)) {
        Serial.println("[WIFI] Failed to start ELATO access point");
        deviceState = IDLE;
        return;
    }

    deviceState = SOFT_AP;

    Serial.printf("[WIFI] ELATO AP is open at %s\n", WiFi.softAPIP().toString().c_str());
    Serial.printf("[WIFI] Join '%s' from the Mac, then open either app\n", ap_ssid);

    xTaskCreatePinnedToCore(
        wifiStationTask,
        "WiFi Station Task",
        4096,
        NULL,
        2,
        NULL,
        0
    );
}

void touchTask(void* parameter) {
  touch_pad_init();
  touch_pad_config(TOUCH_PAD_NUM2);
  
  bool lastTouchState = false;
  unsigned long lastTouchTime = 0;
  unsigned long pressStartTime = 0;
  bool touched = false;
  const unsigned long LONG_PRESS_DURATION = 500; // 500ms for sleep
  
  while (1) {
    uint32_t touchValue = touchRead(TOUCH_PAD_NUM2);
    bool isTouched = (touchValue > TOUCH_THRESHOLD);
    unsigned long currentTime = millis();
    
    // Detect touch press (not touched -> touched) - SCHEDULE LISTENING
    if (isTouched && !lastTouchState && (currentTime - lastTouchTime > TOUCH_DEBOUNCE_DELAY)) {
        if (webSocket.isConnected()) {
            Serial.println("Touch detected - interrupting and scheduling listening...");
            sendInterruptInstruction();
            scheduleListeningRestart = true;
            scheduledTime = millis() + 100; // Start listening in 100ms
        }
      
      touched = true;
      pressStartTime = currentTime;
      lastTouchTime = currentTime;
    }
    
    // Check for long press while touched - SLEEP
    if (touched && isTouched) {
      if (currentTime - pressStartTime >= LONG_PRESS_DURATION) {
        Serial.println("Long press detected - Going to sleep...");
        sleepRequested = true;
      }
    }
    
    // Release detection
    if (!isTouched && touched) {
      touched = false;
      pressStartTime = 0;
    }
    
    lastTouchState = isTouched;
    vTaskDelay(20);
  }
  vTaskDelete(NULL);
}

void setupDeviceMetadata() {
    // quickAuthTokenReset();
    // quickFactoryResetDevice();

    deviceState = IDLE;

    getAuthTokenFromNVS();
}

void setup()
{
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // disables brownout detector

    Serial.begin(115200);
    delay(500);

    // SETUP
    setupDeviceMetadata();
    wsMutex = xSemaphoreCreateMutex();    

    // INTERRUPT
    #ifdef TOUCH_MODE
        xTaskCreate(touchTask, "Touch Task", 4096, NULL, configMAX_PRIORITIES-2, NULL);
    #else
        getErr = esp_sleep_enable_ext0_wakeup(BUTTON_PIN, LOW);
        printOutESP32Error(getErr);
        Button *btn = new Button(BUTTON_PIN, false);
        btn->attachLongPressUpEventCb(&onButtonLongPressUpEventCb, NULL);
        btn->attachDoubleClickEventCb(&onButtonDoubleClickCb, NULL);
        btn->detachSingleClickEvent();
    #endif

    // Pin audio tasks to Core 1 (application core)
    xTaskCreatePinnedToCore(
        ledTask,           // Function
        "LED Task",        // Name
        4096,              // Stack size
        NULL,              // Parameters
        5,                 // Priority
        NULL,              // Handle
        1                  // Core 1 (application core)
    );

    xTaskCreatePinnedToCore(
        audioStreamTask,   // Function
        "Speaker Task",    // Name
        4096,              // Stack size
        NULL,              // Parameters
        3,                 // Priority
        NULL,              // Handle
        1                  // Core 1 (application core)
    );

    xTaskCreatePinnedToCore(
        micTask,           // Function
        "Microphone Task", // Name
        4096,              // Stack size
        NULL,              // Parameters
        4,                 // Priority
        NULL,              // Handle
        1                  // Core 1 (application core)
    );

    // Pin network task to Core 0 (protocol core)
    xTaskCreatePinnedToCore(
        networkTask,       // Function
        "Websocket Task",  // Name
        8192,              // Stack size
        NULL,              // Parameters
        configMAX_PRIORITIES-1, // Highest priority
        &networkTaskHandle,// Handle
        0                  // Core 0 (protocol core)
    );

    // WIFI
    setupWiFi();
}

void loop(){
    processSleepRequest();
    delay(10);
}
