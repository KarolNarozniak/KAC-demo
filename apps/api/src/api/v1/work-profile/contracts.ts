import type { FastifyInstance, FastifySchema, FastifyError } from 'fastify';
const contracts: Record<string, FastifySchema> = {
  "GET /work-profile/compensation": {
    "tags": [
      "Work profile"
    ],
    "operationId": "getWorkCompensation",
    "summary": "Odczyt aktywnego profilu",
    "description": "",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "version",
          "hourlyRatePln",
          "rateKind",
          "commuteMinutes",
          "minRestMinutes",
          "minHours",
          "targetHours",
          "maxHours"
        ],
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "hourlyRatePln": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 9999999999.99,
                "multipleOf": 0.01
              },
              {
                "type": "null"
              }
            ],
            "description": "PLN/h; null = brak stawki i profile_incomplete przy generowaniu. Zero jest jawną poprawną stawką."
          },
          "rateKind": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "gross",
                  "net"
                ]
              },
              {
                "type": "null"
              }
            ],
            "description": "gross = brutto, net = netto. Wymagane przy ustawionej stawce. Bez konwersji podatkowej."
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ],
            "description": "Jeden stały bufor MVP przed i po pracy, również dla pustego location; bez map i geokodowania. Null oznacza nieustawiony dojazd i blokuje planowanie; 0 jest poprawne."
          },
          "minRestMinutes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10080
          },
          "minHours": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 999.99,
                "multipleOf": 0.01
              },
              {
                "type": "null"
              }
            ]
          },
          "targetHours": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 999.99,
                "multipleOf": 0.01
              },
              {
                "type": "null"
              }
            ]
          },
          "maxHours": {
            "anyOf": [
              {
                "type": "number",
                "maximum": 999.99,
                "multipleOf": 0.01,
                "exclusiveMinimum": 0
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "example": {
          "version": 1,
          "hourlyRatePln": 30,
          "rateKind": "gross",
          "commuteMinutes": 30,
          "minRestMinutes": 660,
          "minHours": 10,
          "targetHours": 20,
          "maxHours": 30
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "PUT /work-profile/compensation": {
    "tags": [
      "Work profile"
    ],
    "operationId": "updateWorkCompensation",
    "summary": "Zapis pełnego profilu z wersją",
    "description": "Zwiększa wersję wspólną z dostępnością. Nie zmienia wydarzeń ani snapshotów. 0 jest dozwolone; null oznacza brak. Kwota wymaga gross lub net; maksimum dwie cyfry po przecinku, numeric(12,2).",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "version",
          "hourlyRatePln",
          "rateKind",
          "commuteMinutes",
          "minRestMinutes",
          "minHours",
          "targetHours",
          "maxHours"
        ],
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "hourlyRatePln": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 9999999999.99,
                "multipleOf": 0.01
              },
              {
                "type": "null"
              }
            ],
            "description": "PLN/h; null = brak stawki i profile_incomplete przy generowaniu. Zero jest jawną poprawną stawką."
          },
          "rateKind": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "gross",
                  "net"
                ]
              },
              {
                "type": "null"
              }
            ],
            "description": "gross = brutto, net = netto. Wymagane przy ustawionej stawce. Bez konwersji podatkowej."
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ],
            "description": "Jeden stały bufor MVP przed i po pracy, również dla pustego location; bez map i geokodowania. Null oznacza nieustawiony dojazd i blokuje planowanie; 0 jest poprawne."
          },
          "minRestMinutes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10080
          },
          "minHours": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 999.99,
                "multipleOf": 0.01
              },
              {
                "type": "null"
              }
            ]
          },
          "targetHours": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 999.99,
                "multipleOf": 0.01
              },
              {
                "type": "null"
              }
            ]
          },
          "maxHours": {
            "anyOf": [
              {
                "type": "number",
                "maximum": 999.99,
                "multipleOf": 0.01,
                "exclusiveMinimum": 0
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "example": {
          "version": 1,
          "hourlyRatePln": 30,
          "rateKind": "gross",
          "commuteMinutes": 30,
          "minRestMinutes": 660,
          "minHours": 10,
          "targetHours": 20,
          "maxHours": 30
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "409": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "422": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "GET /work-profile/availability": {
    "tags": [
      "Work profile"
    ],
    "operationId": "get_work_profile_availability",
    "summary": "Odczyt tygodniowej dostępności",
    "description": "",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "version",
          "intervals"
        ],
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "intervals": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "dayOfWeek",
                "startTime",
                "endTime"
              ],
              "properties": {
                "dayOfWeek": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 7
                },
                "startTime": {
                  "type": "string",
                  "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
                },
                "endTime": {
                  "type": "string",
                  "pattern": "^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$"
                }
              }
            }
          }
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "PUT /work-profile/availability": {
    "tags": [
      "Work profile"
    ],
    "operationId": "put_work_profile_availability",
    "summary": "Atomowe zastąpienie dostępności",
    "description": "Dni ISO 1–7. Zakresy nocne dzielone na północy, również 7→1. Zachowuje 24:00, sortuje po dniu i początku. Duplikaty i przecięcia: 422; stykające zakresy dozwolone. Edytor scala przecięcia przed PUT. Pusta lista usuwa dostępność. Blokada profilu FOR UPDATE, kontrola wersji, rollback całej operacji. Nie modyfikuje wydarzeń.",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "version",
          "intervals"
        ],
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "intervals": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "dayOfWeek",
                "startTime",
                "endTime"
              ],
              "properties": {
                "dayOfWeek": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 7
                },
                "startTime": {
                  "type": "string",
                  "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
                },
                "endTime": {
                  "type": "string",
                  "pattern": "^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$"
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "409": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "422": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "GET /work-profile/schedules": {
    "tags": [
      "Scheduling"
    ],
    "operationId": "get_work_profile_schedules",
    "summary": "Lista zapisanych grafików dla tygodnia",
    "description": "",
    "response": {
      "200": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id",
            "status",
            "week",
            "commuteMinutes",
            "plannedHours",
            "targetHours",
            "estimatedPayPln",
            "achievable",
            "shifts"
          ],
          "properties": {
            "id": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": [
                "Proposed",
                "Accepted",
                "Rejected"
              ]
            },
            "week": {
              "type": "string",
              "format": "date"
            },
            "commuteMinutes": {
              "anyOf": [
                {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 10080
                },
                {
                  "type": "null"
                }
              ]
            },
            "plannedHours": {
              "type": "number",
              "minimum": 0
            },
            "targetHours": {
              "type": "number",
              "minimum": 0
            },
            "estimatedPayPln": {
              "type": "number",
              "minimum": 0,
              "description": "Suma kwot zaokrąglonych osobno dla zmian, a nie ponowne przeliczenie łącznego czasu. Zero przy braku zmian. Dojazd nie jest płatny."
            },
            "achievable": {
              "type": "boolean"
            },
            "shifts": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "start",
                  "end",
                  "category",
                  "hourlyRatePln",
                  "estimatedPayPln",
                  "rateKind"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "start": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "end": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "category": {
                    "const": "Work"
                  },
                  "hourlyRatePln": {
                    "type": "number",
                    "minimum": 0,
                    "description": "Trwały snapshot stawki PLN/h w momencie generowania. Nie aktualizuje się po zmianie profilu."
                  },
                  "estimatedPayPln": {
                    "type": "number",
                    "minimum": 0,
                    "description": "Snapshot kwoty: halfUp(rateGrosz × rzeczywiste minuty / 60) / 100; zaokrąglanie osobno dla każdej zmiany."
                  },
                  "rateKind": {
                    "anyOf": [
                      {
                        "type": "string",
                        "enum": [
                          "gross",
                          "net"
                        ]
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "POST /work-profile/schedules/generate": {
    "tags": [
      "Scheduling"
    ],
    "operationId": "post_work_profile_schedules_generate",
    "summary": "Generowanie propozycji",
    "description": "Wymaga ustawienia stawki, rodzaju kwoty, dojazdu i celu; brak daje profile_incomplete z details.fields. Algorytm deterministyczny wypełnia najwcześniejsze poprawne okna, respektuje maksymalną liczbę godzin. Nie gwarantuje globalnie optymalnego planu. Brak okien daje pustą propozycję i achievable=false, jeśli cel > 0. Płatna praca mieści się w tygodniu; bufor może korzystać z ciągłej dostępności sąsiedniego tygodnia. Wydarzenia cykliczne materializowane w strefie kalendarza, odstępy liczone na instantach. Między Work i Class/Personal wymagany commuteMinutes, między Work i Work max(commuteMinutes,minRestMinutes), bez sumowania. Bufor mieści się w ciągłym oknie dostępności. Nie powstają wydarzenia dojazdu ani pracy do chwili akceptacji.",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "status",
          "week",
          "commuteMinutes",
          "plannedHours",
          "targetHours",
          "estimatedPayPln",
          "achievable",
          "shifts"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "Proposed",
              "Accepted",
              "Rejected"
            ]
          },
          "week": {
            "type": "string",
            "format": "date"
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ]
          },
          "plannedHours": {
            "type": "number",
            "minimum": 0
          },
          "targetHours": {
            "type": "number",
            "minimum": 0
          },
          "estimatedPayPln": {
            "type": "number",
            "minimum": 0,
            "description": "Suma kwot zaokrąglonych osobno dla zmian, a nie ponowne przeliczenie łącznego czasu. Zero przy braku zmian. Dojazd nie jest płatny."
          },
          "achievable": {
            "type": "boolean"
          },
          "shifts": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "start",
                "end",
                "category",
                "hourlyRatePln",
                "estimatedPayPln",
                "rateKind"
              ],
              "properties": {
                "id": {
                  "type": "string"
                },
                "start": {
                  "type": "string",
                  "format": "date-time"
                },
                "end": {
                  "type": "string",
                  "format": "date-time"
                },
                "category": {
                  "const": "Work"
                },
                "hourlyRatePln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Trwały snapshot stawki PLN/h w momencie generowania. Nie aktualizuje się po zmianie profilu."
                },
                "estimatedPayPln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Snapshot kwoty: halfUp(rateGrosz × rzeczywiste minuty / 60) / 100; zaokrąglanie osobno dla każdej zmiany."
                },
                "rateKind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "gross",
                        "net"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "409": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "422": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "GET /work-profile/schedules/{id}": {
    "tags": [
      "Scheduling"
    ],
    "operationId": "get_work_profile_schedules_id",
    "summary": "Odczyt grafiku i snapshotów",
    "description": "",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "status",
          "week",
          "commuteMinutes",
          "plannedHours",
          "targetHours",
          "estimatedPayPln",
          "achievable",
          "shifts"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "Proposed",
              "Accepted",
              "Rejected"
            ]
          },
          "week": {
            "type": "string",
            "format": "date"
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ]
          },
          "plannedHours": {
            "type": "number",
            "minimum": 0
          },
          "targetHours": {
            "type": "number",
            "minimum": 0
          },
          "estimatedPayPln": {
            "type": "number",
            "minimum": 0,
            "description": "Suma kwot zaokrąglonych osobno dla zmian, a nie ponowne przeliczenie łącznego czasu. Zero przy braku zmian. Dojazd nie jest płatny."
          },
          "achievable": {
            "type": "boolean"
          },
          "shifts": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "start",
                "end",
                "category",
                "hourlyRatePln",
                "estimatedPayPln",
                "rateKind"
              ],
              "properties": {
                "id": {
                  "type": "string"
                },
                "start": {
                  "type": "string",
                  "format": "date-time"
                },
                "end": {
                  "type": "string",
                  "format": "date-time"
                },
                "category": {
                  "const": "Work"
                },
                "hourlyRatePln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Trwały snapshot stawki PLN/h w momencie generowania. Nie aktualizuje się po zmianie profilu."
                },
                "estimatedPayPln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Snapshot kwoty: halfUp(rateGrosz × rzeczywiste minuty / 60) / 100; zaokrąglanie osobno dla każdej zmiany."
                },
                "rateKind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "gross",
                        "net"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "PUT /work-profile/schedules/{id}/shifts/{shiftId}": {
    "tags": [
      "Scheduling"
    ],
    "operationId": "put_work_profile_schedules_id_shifts_shiftId",
    "summary": "Korekta zmiany w propozycji",
    "description": "Sprawdza aktualny profil, dostępność, odstępy i wydarzenia, także poza tygodniem. Odrzucenie zachowuje poprzednią zmianę. Przelicza kwotę tylko według snapshotu stawki tej zmiany; nie stosuje bieżącej stawki profilu.",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "status",
          "week",
          "commuteMinutes",
          "plannedHours",
          "targetHours",
          "estimatedPayPln",
          "achievable",
          "shifts"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "Proposed",
              "Accepted",
              "Rejected"
            ]
          },
          "week": {
            "type": "string",
            "format": "date"
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ]
          },
          "plannedHours": {
            "type": "number",
            "minimum": 0
          },
          "targetHours": {
            "type": "number",
            "minimum": 0
          },
          "estimatedPayPln": {
            "type": "number",
            "minimum": 0,
            "description": "Suma kwot zaokrąglonych osobno dla zmian, a nie ponowne przeliczenie łącznego czasu. Zero przy braku zmian. Dojazd nie jest płatny."
          },
          "achievable": {
            "type": "boolean"
          },
          "shifts": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "start",
                "end",
                "category",
                "hourlyRatePln",
                "estimatedPayPln",
                "rateKind"
              ],
              "properties": {
                "id": {
                  "type": "string"
                },
                "start": {
                  "type": "string",
                  "format": "date-time"
                },
                "end": {
                  "type": "string",
                  "format": "date-time"
                },
                "category": {
                  "const": "Work"
                },
                "hourlyRatePln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Trwały snapshot stawki PLN/h w momencie generowania. Nie aktualizuje się po zmianie profilu."
                },
                "estimatedPayPln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Snapshot kwoty: halfUp(rateGrosz × rzeczywiste minuty / 60) / 100; zaokrąglanie osobno dla każdej zmiany."
                },
                "rateKind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "gross",
                        "net"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "409": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "422": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "POST /work-profile/schedules/{id}/accept": {
    "tags": [
      "Scheduling"
    ],
    "operationId": "post_work_profile_schedules_id_accept",
    "summary": "Atomowa akceptacja i zapis do kalendarza",
    "description": "Blokuje własny kalendarz oraz grafik; ponownie sprawdza bieżące ograniczenia, w tym nowe wydarzenia. Wszystkie zmiany albo żadna. Nie modyfikuje snapshotów kwot ani rodzaju kwoty. Ponowna akceptacja: 409. commuteMinutes w odpowiedzi jest snapshotem bufora użytego przy generowaniu; walidacja używa aktualnego profilu.",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "status",
          "week",
          "commuteMinutes",
          "plannedHours",
          "targetHours",
          "estimatedPayPln",
          "achievable",
          "shifts"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "Proposed",
              "Accepted",
              "Rejected"
            ]
          },
          "week": {
            "type": "string",
            "format": "date"
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ]
          },
          "plannedHours": {
            "type": "number",
            "minimum": 0
          },
          "targetHours": {
            "type": "number",
            "minimum": 0
          },
          "estimatedPayPln": {
            "type": "number",
            "minimum": 0,
            "description": "Suma kwot zaokrąglonych osobno dla zmian, a nie ponowne przeliczenie łącznego czasu. Zero przy braku zmian. Dojazd nie jest płatny."
          },
          "achievable": {
            "type": "boolean"
          },
          "shifts": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "start",
                "end",
                "category",
                "hourlyRatePln",
                "estimatedPayPln",
                "rateKind"
              ],
              "properties": {
                "id": {
                  "type": "string"
                },
                "start": {
                  "type": "string",
                  "format": "date-time"
                },
                "end": {
                  "type": "string",
                  "format": "date-time"
                },
                "category": {
                  "const": "Work"
                },
                "hourlyRatePln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Trwały snapshot stawki PLN/h w momencie generowania. Nie aktualizuje się po zmianie profilu."
                },
                "estimatedPayPln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Snapshot kwoty: halfUp(rateGrosz × rzeczywiste minuty / 60) / 100; zaokrąglanie osobno dla każdej zmiany."
                },
                "rateKind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "gross",
                        "net"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "409": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "422": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  },
  "POST /work-profile/schedules/{id}/reject": {
    "tags": [
      "Scheduling"
    ],
    "operationId": "post_work_profile_schedules_id_reject",
    "summary": "Odrzucenie propozycji bez zapisu wydarzeń",
    "description": "",
    "response": {
      "200": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "status",
          "week",
          "commuteMinutes",
          "plannedHours",
          "targetHours",
          "estimatedPayPln",
          "achievable",
          "shifts"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "Proposed",
              "Accepted",
              "Rejected"
            ]
          },
          "week": {
            "type": "string",
            "format": "date"
          },
          "commuteMinutes": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 10080
              },
              {
                "type": "null"
              }
            ]
          },
          "plannedHours": {
            "type": "number",
            "minimum": 0
          },
          "targetHours": {
            "type": "number",
            "minimum": 0
          },
          "estimatedPayPln": {
            "type": "number",
            "minimum": 0,
            "description": "Suma kwot zaokrąglonych osobno dla zmian, a nie ponowne przeliczenie łącznego czasu. Zero przy braku zmian. Dojazd nie jest płatny."
          },
          "achievable": {
            "type": "boolean"
          },
          "shifts": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "start",
                "end",
                "category",
                "hourlyRatePln",
                "estimatedPayPln",
                "rateKind"
              ],
              "properties": {
                "id": {
                  "type": "string"
                },
                "start": {
                  "type": "string",
                  "format": "date-time"
                },
                "end": {
                  "type": "string",
                  "format": "date-time"
                },
                "category": {
                  "const": "Work"
                },
                "hourlyRatePln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Trwały snapshot stawki PLN/h w momencie generowania. Nie aktualizuje się po zmianie profilu."
                },
                "estimatedPayPln": {
                  "type": "number",
                  "minimum": 0,
                  "description": "Snapshot kwoty: halfUp(rateGrosz × rzeczywiste minuty / 60) / 100; zaokrąglanie osobno dla każdej zmiany."
                },
                "rateKind": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "gross",
                        "net"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          }
        }
      },
      "400": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "404": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "409": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      },
      "503": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string"
          },
          "details": {}
        }
      }
    }
  }
};
export function installWorkProfileContracts(app: FastifyInstance) {
 app.addHook('onRoute', route => {
  if (route.method === 'HEAD') return;
  const path=route.url.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g,'{$1}');
  const contract=contracts[`${route.method} ${path}`];
  if(!contract) throw new Error(`Missing work-profile contract: ${route.method} ${path}`);
  route.schema={...route.schema,...contract};
 });
 app.setErrorHandler<FastifyError>((error,_req,reply)=>{
  if(error.validation) return reply.code(400).send({error:'invalid_request',details:error.validation});
  return reply.send(error);
 });
}
