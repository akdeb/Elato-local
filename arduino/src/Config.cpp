#include "Config.h"
#include <nvs_flash.h>

// ! define preferences
Preferences preferences;
volatile bool sleepRequested = false;

const char *ap_ssid = "ELATO";
String ws_server_ip = "";
const uint16_t ws_port = 49320;
const char *ws_path = "/ws/esp32";

String authTokenGlobal;
volatile DeviceState deviceState = IDLE;
volatile bool apStationConnected = false;

// I2S and Audio parameters
const uint32_t SAMPLE_RATE = 48000;
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
