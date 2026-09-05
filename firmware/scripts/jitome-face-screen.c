/* Headless host for the mcsim screen ABI. Test-only, never included in firmware. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <dlfcn.h>
#include "screen.h"

static double interval;
static gint64 deadline;
static int frames;
static const char *output;
static void noop(txScreen *screen) { (void)screen; }
static void changed(txScreen *screen) {
  uint32_t hash = 2166136261u;
  for (int i = 0; i < screen->width * screen->height * 4; i++) hash = (hash ^ screen->buffer[i]) * 16777619u;
  printf("FRAME %08x\n", hash);
  if (frames < 64) {
    char path[4096];
    snprintf(path, sizeof(path), "%s/frame-%03d.rgba", output, frames);
    FILE *file = fopen(path, "wb");
    if (!file) exit(2);
    fwrite(screen->buffer, 1, screen->width * screen->height * 4, file);
    fclose(file);
  }
  frames++;
}
static void start(txScreen *screen, double ms) {
  (void)screen; interval = ms; deadline = g_get_monotonic_time() + (gint64)(ms * 1000);
}
static void stop(txScreen *screen) { (void)screen; interval = 0; }
static void abortScreen(txScreen *screen, int status) {
  (void)screen; fprintf(stderr, "SIMULATOR ABORT %d\n", status); exit(1);
}
static void post(txScreen *screen, char *message, int size) { (void)screen; (void)message; (void)size; }
static gboolean tick(gpointer data) {
  txScreen *screen = data;
  if (interval && g_get_monotonic_time() >= deadline) {
    deadline = g_get_monotonic_time() + (gint64)(interval * 1000);
    screen->idle(screen);
  }
  return G_SOURCE_CONTINUE;
}
static gboolean finish(gpointer loop) { g_main_loop_quit(loop); return G_SOURCE_REMOVE; }
int main(int argc, char **argv) {
  if (argc != 3 && argc != 4) return 2;
  output = argv[2];
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!library) { fprintf(stderr, "%s\n", dlerror()); return 2; }
  txScreenLaunchProc launch = (txScreenLaunchProc)dlsym(library, "fxScreenLaunch");
  if (!launch) return 2;
  txScreen *screen = calloc(1, sizeof(txScreen) + 320 * 240 * 4);
  if (!screen) return 2;
  screen->width = 320; screen->height = 240;
  screen->abort = abortScreen; screen->bufferChanged = changed;
  screen->formatChanged = noop; screen->start = start; screen->stop = stop; screen->post = post;
  mxCreateMutex(&screen->workersMutex);
  launch(screen);
  GMainLoop *loop = g_main_loop_new(NULL, FALSE);
  guint timer = g_timeout_add(1, tick, screen);
  g_timeout_add_seconds(argc == 4 ? atoi(argv[3]) : 4, finish, loop);
  g_main_loop_run(loop);
  g_source_remove(timer);
  if (screen->quit) screen->quit(screen);
  g_main_loop_unref(loop);
  mxDeleteMutex(&screen->workersMutex);
  free(screen); dlclose(library);
  return 0;
}
