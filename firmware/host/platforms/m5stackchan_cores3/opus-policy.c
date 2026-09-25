// CoreS3 voice encoding policy, using the codec's public registration API.
#include "esp_audio_enc_reg.h"
#include "esp_opus_enc.h"
#include "esp_audio_dec_reg.h"
#include "esp_opus_dec.h"
static esp_audio_dec_ops_t originalDecoder, configuredDecoder;
static esp_audio_enc_ops_t original, configured;
int stackchanOpusOriginalComplexity = -1, stackchanOpusOriginalBitrate = -1, stackchanOpusOriginalMode = -1;
static esp_audio_err_t openVoiceEncoder(void *options, uint32_t size, void **handle) {
  if (size != sizeof(esp_opus_enc_config_t)) return original.open(options, size, handle);
  esp_opus_enc_config_t config = *(esp_opus_enc_config_t *)options;
  stackchanOpusOriginalComplexity = config.complexity;
  stackchanOpusOriginalBitrate = config.bitrate;
  stackchanOpusOriginalMode = config.application_mode;
  // Keep the rate, channels, frame duration and bitrate. Restricted low-delay
  // mode avoids the SILK encoder's bursty work while retaining standard Opus.
  if (config.sample_rate == 16000 && config.channel == 1) {
    config.complexity = 0;
    config.application_mode = ESP_OPUS_ENC_APPLICATION_LOWDELAY;
  }
  return original.open(&config, size, handle);
}
static esp_audio_err_t openMonoDecoder(void *options, uint32_t size, void **handle) {
  if (size != sizeof(esp_opus_dec_cfg_t)) return originalDecoder.open(options, size, handle);
  esp_opus_dec_cfg_t config = *(esp_opus_dec_cfg_t *)options;
  // CoreS3 has one speaker. Let Opus downmix, and report the actual channel
  // count through the standard decoder info, instead of decoding two outputs
  // and converting them to mono in the renderer.
  config.channel = 1;
  return originalDecoder.open(&config, size, handle);
}
int stackchanInstallOpusPolicy(void) {
  const esp_audio_enc_ops_t *ops = esp_audio_enc_get_ops(ESP_AUDIO_TYPE_OPUS);
  if (!ops) return ESP_AUDIO_ERR_INVALID_PARAMETER;
  if (ops->open != openVoiceEncoder) {
    original = *ops; configured = original; configured.open = openVoiceEncoder;
    esp_audio_enc_unregister(ESP_AUDIO_TYPE_OPUS);
    int error = esp_audio_enc_register(ESP_AUDIO_TYPE_OPUS, &configured);
    if (error) {
      esp_audio_enc_register(ESP_AUDIO_TYPE_OPUS, &original);
      return error;
    }
  }
  const esp_audio_dec_ops_t *decoder = esp_audio_dec_get_ops(ESP_AUDIO_TYPE_OPUS);
  if (!decoder) return ESP_AUDIO_ERR_INVALID_PARAMETER;
  if (decoder->open == openMonoDecoder) return ESP_AUDIO_ERR_OK;
  originalDecoder = *decoder; configuredDecoder = originalDecoder;
  configuredDecoder.open = openMonoDecoder;
  esp_audio_dec_unregister(ESP_AUDIO_TYPE_OPUS);
  int error = esp_audio_dec_register(ESP_AUDIO_TYPE_OPUS, &configuredDecoder);
  if (error) {
    esp_audio_dec_register(ESP_AUDIO_TYPE_OPUS, &originalDecoder);
    return error;
  }
  return ESP_AUDIO_ERR_OK;
}
