typedef struct {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  uint8_t pad;
} ColorRGB;

typedef struct {
  float open;
} MouthState;

typedef struct {
  float open;
  float gazeX;
  float gazeY;
} EyeState;

typedef struct {
  EyeState left;
  EyeState right;
} EyesState;

typedef struct {
  ColorRGB primary;
  ColorRGB secondary;
} ThemeState;

typedef struct {
  MouthState mouth;
  EyesState eyes;
  float breath;
  uint8_t emotion;
  uint8_t pad0;
  uint8_t pad1;
  uint8_t pad2;
  ThemeState theme;
} FaceStateView;
