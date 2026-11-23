# Datos de la ejecución

|  |  |
|---|---|
| Versión de la skill | 0.1.0 |
| Versión del motor | 0.1.0 |
| Modelo | test-model; identificador informado por: el propio agente, que puede equivocarse |
| Revisión evaluada | inventory:0e6da176a1aecf04 |
| Fecha | 2026-11-20 |
| Revisor | Marcos Lima, 2026-11-21 |

# Qué prueba y qué no prueba el verificador

Prueba que cada extracto citado existe en las líneas citadas de los archivos inventariados, que una búsqueda de ausencia no encontró coincidencias en un alcance no vacío y que la salida guardada no cambió desde su captura.

No prueba que un extracto respalde la afirmación, que una búsqueda de ausencia cubra todos los lugares donde podría estar un control, ni que una declaración, documento o página web sea verdadero.

Un escaneo heurístico busca secretos en los datos y en este informe. No puede probar que no los haya: una persona debe revisar antes de que el informe salga del equipo.

# Convenciones

La confianza, la severidad y el esfuerzo siguen reglas fijas calculadas por código, no por el modelo. Los umbrales son convenciones de esta skill, no resultados de investigación.

Confianza: Verificado significa que al menos una cita verificada automáticamente pasa; Corroborado, dos fuentes independientes y ninguna verificada automáticamente; Informado, una fuente; No verificado, sin evidencia o con todas las citas fallidas. Solo los hallazgos Verificados pueden ser Críticos o Altos; Corroborado e Informado quedan limitados a Media.

Esfuerzo en personas-día: S 1-2; M 3-10; L 11-30; XL \>30.

Se usaron las escalas por defecto de severidad y esfuerzo.
