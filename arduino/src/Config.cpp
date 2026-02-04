#include "Config.h"
#include <nvs_flash.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <WiFiClient.h>

// ! define preferences
Preferences preferences;
volatile bool sleepRequested = false;

String ws_server_ip = "";  // Dynamically discovered via mDNS
const uint16_t ws_port = 8000;
const char *ws_path = "/ws/esp32";

static bool isReachable(const String &ip, uint16_t port, uint32_t timeoutMs = 1500) {
    WiFiClient probe;
    bool ok = probe.connect(ip.c_str(), port, timeoutMs);
    if (ok) {
        probe.stop();
        return true;
    }
    return false;
}

static bool cacheServer(const String &ip, uint16_t port) {
    preferences.begin("server", false);
    preferences.putString("ws_ip", ip);
    preferences.putUInt("ws_port", port);
    preferences.end();
    return true;
}

static void clearCachedServer() {
    preferences.begin("server", false);
    preferences.remove("ws_ip");
    preferences.remove("ws_port");
    preferences.end();
}

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
    static bool mdns_started = false;
    if (!mdns_started) {
        if (!MDNS.begin("elato-device")) {
            Serial.println("[mDNS] Failed to start mDNS responder");
            mdns_started = false;
        } else {
            mdns_started = true;
        }
    }
    
    // Query for _elato._tcp service
    Serial.println("[mDNS] Querying for _elato._tcp.local...");
    
    const unsigned long start = millis();
    int n = 0;
    while ((millis() - start) < (unsigned long)timeoutMs) {
        n = MDNS.queryService("elato", "tcp");
        if (n > 0) {
            break;
        }
        delay(250);
    }
    if (n == 0) {
        WiFiUDP udp;
        udp.begin(1900);
        unsigned long startUdp = millis();
        char buf[128];
        while ((millis() - startUdp) < 3000) {
            int packetSize = udp.parsePacket();
            if (packetSize > 0 && packetSize < (int)sizeof(buf)) {
                int len = udp.read(buf, sizeof(buf) - 1);
                buf[len] = '\0';
                String msg = String(buf);
                if (msg.startsWith("ELATO_SERVER ")) {
                    int first = msg.indexOf(' ');
                    int second = msg.indexOf(' ', first + 1);
                    if (second > first) {
                        outIp = msg.substring(first + 1, second);
                        outPort = (uint16_t)msg.substring(second + 1).toInt();
                        if (!isReachable(outIp, outPort)) {
                            Serial.printf("[UDP] Server %s:%d not reachable\n", outIp.c_str(), outPort);
                            udp.stop();
                            return false;
                        }
                        Serial.printf("[UDP] Found server %s:%d\n", outIp.c_str(), outPort);
                        cacheServer(outIp, outPort);
                        udp.stop();
                        return true;
                    }
                }
            }
            delay(100);
        }
        udp.stop();

        IPAddress hostIp = MDNS.queryHost("elato");
        if (hostIp) {
            IPAddress localIp = WiFi.localIP();
            IPAddress mask = WiFi.subnetMask();
            bool sameSubnet = ((uint32_t)localIp & (uint32_t)mask) == ((uint32_t)hostIp & (uint32_t)mask);
            if (sameSubnet) {
                outIp = hostIp.toString();
                int n2 = MDNS.queryService("elato", "tcp");
                outPort = n2 > 0 ? MDNS.port(0) : ws_port;
                if (!isReachable(outIp, outPort)) {
                    Serial.printf("[mDNS] Host elato.local %s:%d not reachable\n", outIp.c_str(), outPort);
                } else {
                    Serial.printf("[mDNS] Found host elato.local at %s:%d\n", outIp.c_str(), outPort);
                    cacheServer(outIp, outPort);
                    return true;
                }
            }
            Serial.printf("[mDNS] Ignoring elato.local at %s (different subnet)\n", hostIp.toString().c_str());
        }

        preferences.begin("server", true);
        String cachedIp = preferences.getString("ws_ip", "");
        uint32_t cachedPort = preferences.getUInt("ws_port", ws_port);
        preferences.end();

        if (cachedIp.length() > 0) {
            IPAddress cachedAddr;
            if (cachedAddr.fromString(cachedIp)) {
                IPAddress localIp = WiFi.localIP();
                IPAddress mask = WiFi.subnetMask();
                bool sameSubnet = ((uint32_t)localIp & (uint32_t)mask) == ((uint32_t)cachedAddr & (uint32_t)mask);
                if (sameSubnet && isReachable(cachedIp, (uint16_t)cachedPort)) {
                    outIp = cachedIp;
                    outPort = (uint16_t)cachedPort;
                    Serial.printf("[mDNS] Using cached server %s:%d\n", outIp.c_str(), outPort);
                    return true;
                }
            }

            clearCachedServer();
            Serial.println("[mDNS] Cached server is not reachable, clearing cache");
        }

        Serial.println("[mDNS] No Elato server found on the network");
        return false;
    }
    
    // Use the first discovered service
    outIp = MDNS.IP(0).toString();
    outPort = MDNS.port(0);
    if (!isReachable(outIp, outPort)) {
        Serial.printf("[mDNS] Service %s:%d not reachable\n", outIp.c_str(), outPort);
        return false;
    }

    Serial.printf("[mDNS] Found Elato server at %s:%d\n", outIp.c_str(), outPort);
    cacheServer(outIp, outPort);
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
