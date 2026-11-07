#pragma once
typedef struct TestObject TestObject;
typedef struct TestValue { double number; TestObject *object; } TestValue;
extern TestValue result, variables[2];
TestValue testNewObject(void);
void testSet(TestValue object, const char *key, TestValue value);
#define xsmcVars(n) ((void)the)
#define xsResult result
#define xsVar(i) variables[i]
#define xsID(name) (name)
#define xsmcSetNewObject(slot) ((slot) = testNewObject())
#define xsmcSetNumber(slot, value) ((slot) = (TestValue){.number = (value)})
#define xsmcSet(object, key, value) testSet(object, key, value)
