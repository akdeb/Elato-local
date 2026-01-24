#include <Arduino.h>
#include <driver/rtc_io.h>
#include "LEDHandler.h"
#include "Config.h"
#include "SPIFFS.h"
#include "WifiManager.h"
#include <driver/touch_sensor.h>
#include "Button.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// #define WEBSOCKETS_DEBUG_LEVEL WEBSOCKETS_LEVEL_ALL

#define TOUCH_THRESHOLD 22500
#define SLEEP_THRESHOLD 1000
#define REQUIRED_RELEASE_CHECKS 100     // how many consecutive times we need "below threshold" to confirm release
#define TOUCH_DEBOUNCE_DELAY 500 // milliseconds

AsyncWebServer webServer(80);
WIFIMANAGER WifiManager;
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

void setupWiFi()
{
    WifiManager.startBackgroundTask("ELATO");  // Run the background task to take care of our Wifi
    WifiManager.fallbackToSoftAp(true);        // Run a SoftAP if no known AP can be reached
    WifiManager.attachWebServer(&webServer);   // Attach our API to the Webserver 
    WifiManager.attachUI();                    // Attach the UI to the Webserver
  
    // Run the Webserver and add your webpages to it
    webServer.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
        request->redirect("/wifi");
    });
    
    // Catch-all handler for captive portal - redirect everything to WiFi config
    webServer.onNotFound([](AsyncWebServerRequest *request) {
      String host = request->host();
      String url = request->url();
      
      Serial.printf("[CAPTIVE] Unknown request - Host: %s, URL: %s\n", host.c_str(), url.c_str());
      
      // For captive portal, redirect all requests except API calls
      if (!url.startsWith("/api/")) {
        Serial.println("[CAPTIVE] Redirecting to /wifi");
      String portalUrl = "http://" + WiFi.softAPIP().toString() + "/wifi";
      request->redirect(portalUrl);
      } else {
        request->send(404, "application/json", "{\"error\":\"Not found\"}");
      }
    });
    
    webServer.begin();
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
            Serial.println("👂 Touch detected - Scheduling listening...");
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
}