#include "Config.h"
#include <nvs_flash.h>
#include <ESPmDNS.h>

// ! define preferences
Preferences preferences;
volatile bool sleepRequested = false;

String ws_server_ip = "";  // Dynamically discovered via mDNS
const uint16_t ws_port = 8000;
const char *ws_path = "/ws/esp32";

/**
 * @brief Discover Elato server via mDNS
 * @param outIp Output: discovered server IP address
 * @param outPort Output: discovered server port
 * @param timeoutMs Timeout in milliseconds for discovery
 * @return true if server found, false otherwise
 */
bool discoverElatoServer(String &outIp, uint16_t &outPort, int timeoutMs) {
    Serial.println("[mDNS] Starting Elato server discovery...");
    
    // Initialize mDNS if not already done
    if (!MDNS.begin("elato-device")) {
        Serial.println("[mDNS] Failed to start mDNS responder");
        return false;
    }
    
    // Query for _elato._tcp service
    Serial.println("[mDNS] Querying for _elato._tcp.local...");
    
    int n = MDNS.queryService("elato", "tcp");
    
    if (n == 0) {
        Serial.println("[mDNS] No Elato server found on the network");
        return false;
    }
    
    // Use the first discovered service
    outIp = MDNS.IP(0).toString();
    outPort = MDNS.port(0);
    
    Serial.printf("[mDNS] Found Elato server at %s:%d\n", outIp.c_str(), outPort);
    
    return true;
}

String authTokenGlobal;
volatile DeviceState deviceState = IDLE;

// I2S and Audio parameters
const uint32_t SAMPLE_RATE = 24000;
const uint32_t INPUT_SAMPLE_RATE = 16000;

// ----------------- Pin Definitions -----------------
const i2s_port_t I2S_PORT_IN = I2S_NUM_1;
const i2s_port_t I2S_PORT_OUT = I2S_NUM_0;

#ifdef USE_NORMAL_ESP32

const int BLUE_LED_PIN = 13;
const int RED_LED_PIN = 9;
const int GREEN_LED_PIN = 8;

const int I2S_SD = 14;
const int I2S_WS = 4;
const int I2S_SCK = 1;

const int I2S_WS_OUT = 5;
const int I2S_BCK_OUT = 6;
const int I2S_DATA_OUT = 7;
const int I2S_SD_OUT = 10;

const gpio_num_t BUTTON_PIN = GPIO_NUM_2; // Only RTC IO are allowed - ESP32 Pin example

#endif
