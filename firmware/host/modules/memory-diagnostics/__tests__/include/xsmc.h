typedef struct Slot Slot;
typedef struct { const char *name; Slot *slot; double number; } Property;
struct Slot { double number; Property properties[8]; int count; };
typedef struct { int unused; } xsMachine;
extern Slot result, variables[2];
void new_object(Slot *slot);
void set_property(Slot *object, const char *name, Slot *value);
#define xsResult result
#define xsVar(i) variables[i]
#define xsID(name) (name)
#define xsmcVars(n) ((void)the, (void)(n))
#define xsmcSetNewObject(slot) new_object(&(slot))
#define xsmcSetNumber(slot, value) ((slot).number = (value))
#define xsmcSet(object, name, value) set_property(&(object), name, &(value))
