
#include <math.h>
#include <stdio.h>
#include <string.h>
struct state {
  int min;
  int max;
  int lastGuess;
};

typedef struct state state;

int nextGuess(int direction, state *state) {
  if (direction == 0) {
    return round((state->max + state->lastGuess) / 2.0);
  } else {
    return round((state->min + state->lastGuess) / 2.0);
  }
}

int handleResponse(char *response, state *state) {
  if (strcmp(response, "higher") == 0) {
    int next = nextGuess(0, state);
    state->min = state->lastGuess;
    state->lastGuess = next;
    return 0;
  }
  if (strcmp(response, "lower") == 0) {
    int next = nextGuess(1, state);
    state->max = state->lastGuess;
    state->lastGuess = next;
    return 0;
  }
  if (strcmp(response, "match") == 0) {
    return 1;
  }
  printf("I'm sorry, I didn't understand that.");
  return 0;
}

char *getInput(char *text);

int step(int steps, state *state) {
  char buffer[50];
  sprintf(buffer, "My guess is %d", state->lastGuess);
  char *response = getInput(buffer);
  int next = handleResponse(response, state);
  if (next == 1) {
    return steps;
  } else {
    return step(steps + 1, state)
  }
}
