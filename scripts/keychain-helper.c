#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_INPUT_SIZE (128 * 1024)
#define MAX_SECRET_SIZE (16 * 1024)

static void secure_zero(void *value, size_t length) {
  volatile uint8_t *bytes = (volatile uint8_t *)value;
  while (length-- > 0) *bytes++ = 0;
}

static void fail(const char *code, int exit_code) {
  (void)write(STDERR_FILENO, code, strlen(code));
  (void)write(STDERR_FILENO, "\n", 1);
  exit(exit_code);
}

static bool write_all(int descriptor, const uint8_t *bytes, size_t length) {
  size_t written = 0;
  while (written < length) {
    ssize_t result = write(descriptor, bytes + written, length - written);
    if (result <= 0) return false;
    written += (size_t)result;
  }
  return true;
}

static bool service_is_allowed(const char *service) {
  return strcmp(service, "com.family-ledger.cdsl.credentials.v1") == 0 ||
         strcmp(service, "com.family-ledger.ingestion.v2") == 0 ||
         strcmp(service, "com.family-ledger.gmail.oauth.v1") == 0 ||
         strcmp(service, "com.family-ledger.hosted-sync.v1") == 0 ||
         strncmp(service, "com.family-ledger.test.", 23) == 0;
}

static char *next_line(char **cursor, char *end) {
  if (*cursor >= end) return NULL;
  char *start = *cursor;
  char *newline = memchr(start, '\n', (size_t)(end - start));
  if (newline == NULL) return NULL;
  *newline = '\0';
  *cursor = newline + 1;
  return start;
}

static CFMutableDictionaryRef create_query(
    CFStringRef service,
    CFStringRef account) {
  CFMutableDictionaryRef query = CFDictionaryCreateMutable(
      kCFAllocatorDefault,
      0,
      &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks);
  if (query == NULL) return NULL;
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service);
  CFDictionarySetValue(query, kSecAttrAccount, account);
  CFDictionarySetValue(query, kSecAttrSynchronizable, kCFBooleanFalse);
  return query;
}

static OSStatus copy_secret(
    CFMutableDictionaryRef base_query,
    CFDataRef *secret) {
  CFMutableDictionaryRef query = CFDictionaryCreateMutableCopy(
      kCFAllocatorDefault, 0, base_query);
  if (query == NULL) return errSecAllocate;
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (status == errSecSuccess) {
    if (result == NULL || CFGetTypeID(result) != CFDataGetTypeID()) {
      if (result != NULL) CFRelease(result);
      return errSecDecode;
    }
    *secret = (CFDataRef)result;
  }
  return status;
}

int main(void) {
  uint8_t *input = calloc(MAX_INPUT_SIZE + 1, 1);
  if (input == NULL) fail("KEYCHAIN_OPERATION_FAILED", 1);

  size_t input_length = 0;
  while (input_length < MAX_INPUT_SIZE) {
    ssize_t count = read(
        STDIN_FILENO,
        input + input_length,
        MAX_INPUT_SIZE - input_length);
    if (count < 0) {
      secure_zero(input, MAX_INPUT_SIZE + 1);
      free(input);
      fail("KEYCHAIN_INVALID_REQUEST", 2);
    }
    if (count == 0) break;
    input_length += (size_t)count;
  }
  if (input_length == 0 || input_length == MAX_INPUT_SIZE) {
    secure_zero(input, MAX_INPUT_SIZE + 1);
    free(input);
    fail("KEYCHAIN_INVALID_REQUEST", 2);
  }

  char *cursor = (char *)input;
  char *end = (char *)input + input_length;
  char *operation = next_line(&cursor, end);
  char *service_value = next_line(&cursor, end);
  char *account_value = next_line(&cursor, end);
  size_t secret_length = (size_t)(end - cursor);
  if (operation == NULL || service_value == NULL || account_value == NULL ||
      !service_is_allowed(service_value) || account_value[0] == '\0' ||
      strlen(service_value) > 100 || strlen(account_value) > 100 ||
      secret_length > MAX_SECRET_SIZE) {
    secure_zero(input, MAX_INPUT_SIZE + 1);
    free(input);
    fail("KEYCHAIN_INVALID_REQUEST", 2);
  }

  CFStringRef service = CFStringCreateWithCString(
      kCFAllocatorDefault, service_value, kCFStringEncodingUTF8);
  CFStringRef account = CFStringCreateWithCString(
      kCFAllocatorDefault, account_value, kCFStringEncodingUTF8);
  if (service == NULL || account == NULL) {
    if (service != NULL) CFRelease(service);
    if (account != NULL) CFRelease(account);
    secure_zero(input, MAX_INPUT_SIZE + 1);
    free(input);
    fail("KEYCHAIN_INVALID_REQUEST", 2);
  }

  CFMutableDictionaryRef query = create_query(service, account);
  if (query == NULL) {
    CFRelease(service);
    CFRelease(account);
    secure_zero(input, MAX_INPUT_SIZE + 1);
    free(input);
    fail("KEYCHAIN_OPERATION_FAILED", 1);
  }

  OSStatus status = errSecSuccess;
  bool output_ok = true;
  if (strcmp(operation, "upsert") == 0) {
    if (secret_length == 0) status = errSecParam;
    CFDataRef secret = secret_length == 0
        ? NULL
        : CFDataCreate(
              kCFAllocatorDefault,
              (const UInt8 *)cursor,
              (CFIndex)secret_length);
    if (secret == NULL) {
      status = errSecAllocate;
    } else {
      const void *update_keys[] = {kSecValueData};
      const void *update_values[] = {secret};
      CFDictionaryRef update = CFDictionaryCreate(
          kCFAllocatorDefault,
          update_keys,
          update_values,
          1,
          &kCFTypeDictionaryKeyCallBacks,
          &kCFTypeDictionaryValueCallBacks);
      status = SecItemUpdate(query, update);
      CFRelease(update);
      if (status == errSecItemNotFound) {
        CFMutableDictionaryRef attributes = CFDictionaryCreateMutableCopy(
            kCFAllocatorDefault, 0, query);
        CFDictionarySetValue(attributes, kSecValueData, secret);
        CFDictionarySetValue(
            attributes,
            kSecAttrAccessible,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly);
        status = SecItemAdd(attributes, NULL);
        CFRelease(attributes);
      }
      CFRelease(secret);
    }
  } else if (strcmp(operation, "read") == 0) {
    CFDataRef secret = NULL;
    status = copy_secret(query, &secret);
    if (status == errSecSuccess) {
      output_ok = write_all(
          STDOUT_FILENO,
          CFDataGetBytePtr(secret),
          (size_t)CFDataGetLength(secret));
      CFRelease(secret);
    }
  } else if (strcmp(operation, "exists") == 0) {
    CFDataRef secret = NULL;
    status = copy_secret(query, &secret);
    if (status == errSecSuccess) {
      output_ok = write_all(STDOUT_FILENO, (const uint8_t *)"1", 1);
      CFRelease(secret);
    } else if (status == errSecItemNotFound) {
      status = errSecSuccess;
      output_ok = write_all(STDOUT_FILENO, (const uint8_t *)"0", 1);
    }
  } else if (strcmp(operation, "delete") == 0) {
    status = SecItemDelete(query);
    if (status == errSecItemNotFound) status = errSecSuccess;
  } else {
    status = errSecParam;
  }

  CFRelease(query);
  CFRelease(service);
  CFRelease(account);
  secure_zero(input, MAX_INPUT_SIZE + 1);
  free(input);

  if (!output_ok) fail("KEYCHAIN_OPERATION_FAILED", 1);
  if (status == errSecItemNotFound) fail("KEYCHAIN_SECRET_NOT_FOUND", 3);
  if (status == errSecParam) fail("KEYCHAIN_INVALID_REQUEST", 2);
  if (status != errSecSuccess) fail("KEYCHAIN_OPERATION_FAILED", 1);
  return 0;
}
