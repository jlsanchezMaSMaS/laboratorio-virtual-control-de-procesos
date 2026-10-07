# Laboratorio Virtual de Dinámica y Control de Procesos

Aplicación didáctica para Ingeniería Agroindustrial, Universidad del Cauca. Incluye un tanque ventilado de agua, bombas con variadores, calentamiento indirecto por vapor y control PI feedback y en cascada. El modelo es concentrado y determinista; las gráficas se generan con la misma simulación física que recibe las señales de control.

## Ejecutar en Windows

1. Abre esta carpeta en el Explorador de archivos y ejecuta `Iniciar_Laboratorio.bat`.
2. Si no abre automáticamente, visita `http://localhost:8000`.
3. Mantén abierta la ventana del servidor durante el uso. Pulsa **Iniciar**, selecciona una velocidad de simulación y cambia consignas, actuadores o perturbaciones. **Pausar** conserva el estado; **Reiniciar** vuelve a parámetros iniciales.
4. Para ejecutar las comprobaciones, abre una terminal en esta carpeta y ejecuta `npm test`. También funciona `node --test tests/model.test.js tests/controllers.test.js tests/simulation.test.js tests/interface.test.js` con Node.js.

No abras `index.html` con `file://`: los módulos JavaScript requieren el servidor local. No se requiere PowerShell aparte de la terminal que normalmente abre Windows con el archivo BAT.

## Arquitectura

- `model.js`: propiedades aproximadas, bombas, pérdidas hidráulicas y balances dinámicos.
- `controllers.js`: PI discreto, sentido de acción, saturación, anti-windup por retrocálculo y seguimiento para transferencia sin salto.
- `instrumentation.js`: lecturas deterministas y escalones de perturbación.
- `simulation.js`: integra modelo, instrumentos, controladores y dos plantas clonadas para comparar feedback/cascada.
- `app.js`, `index.html`, `styles.css`: controles, esquema P&ID, lecturas y tendencias.
- `tests/`: pruebas unitarias del modelo, los controladores, su acoplamiento físico y la interfaz.

## Modelo físico, unidades e hipótesis

El estado principal del tanque es volumen `V` (m³) y temperatura `T` (°C); el nivel es `h=V/A` (m). La presión del tanque es manométrica y el recipiente está ventilado a la atmósfera. El agua se trata como incompresible, con `ρ=997 kg/m³` y `cp=4180 J/(kg·K)` constantes. Se omiten evaporación, reacción y variación de propiedades. El modelo integra con RK4 y paso de 0.1 s; nivel, volumen, temperaturas, frecuencias y apertura tienen límites físicos.

El balance general transitorio de masa es `dM/dt = ṁin − ṁout`. Con densidad constante y caudales volumétricos `Q` en m³/h:

`dV/dt = (Qin − Qout)/3600` y `dh/dt = (Qin − Qout)/(3600 A)`.

La acumulación es distinta de cero durante perturbaciones y arranques. Al vaciarse, no sale más líquido; al llenarse, el exceso se representa como rebose. En el balance de energía, para mezcla ideal, la salida tiene la temperatura del tanque:

`ρ cp V dT/dt = ρ cp (Qin/3600)(Tin − T) + Qvapor − Qpérdidas`.

El término de entalpía de salida se cancela con la acumulación de masa porque ambas corrientes salen a `T`. Sin agitación se representa un volumen concentrado de líquido en el serpentín (`Vcoil=0.015 m³`):

`ρ cp V dT/dt = ρ cp (Qin/3600)(Tin − T) − ρ cp (Qout/3600)(Tout − T) − Qpérdidas`

`ρ cp Vcoil dTout/dt = ρ cp (Qout/3600)(T − Tout) + Qvapor`.

Al activar feedback o cascada de temperatura, la simulación detiene M-101 y usa `Tout` como variable medida y controlada, acorde con el modo intercambiador. En manual, el interruptor o botón dedicado permiten arrancar y detener M-101; si se solicita arrancarlo desde un modo térmico automático, el sistema transfiere primero a manual y conserva la salida de válvula. Con agitación, `Tout=T`; el agitador homogeneiza el contenido, pero no es una fuente de calor. Una temperatura de salida mayor que la de alimento se debe al estado térmico del tanque y al calor suministrado, no al trabajo de agitación por sí solo. Las pérdidas ambientales usan `UAamb=0.018 kW/K` hacia `Tamb=20 °C`.

El vapor es indirecto. La presión de suministro es absoluta (`kPa abs`); la temperatura de saturación aproximada es `Tsat=100 + 30 ln(Pabs/101.325)` °C, limitada a 100–180 °C. El flujo máximo es `0.025 kg/s` a presión nominal, y el flujo por TV-101 escala con apertura y raíz cuadrada de la diferencia de presión. El calor transferido (kW) se limita tanto por entalpía de condensación (`λ=2.2 MJ/kg`) como por `UA=0.42 kW/K` y la diferencia térmica. El agua se limita a 0–99.9 °C.

Las bombas usan una curva cuadrática simplificada de altura, escalada con `(f/60)²`, y resistencias cuadráticas de línea; la alimentación se limita por el caudal solicitado. Frecuencia en Hz, caudal en m³/h. Las presiones de línea se calculan como manométricas en kPa; el P&ID y la lectura principal las presentan en bar(a), mientras que la lectura secundaria y la gráfica hidráulica indican bar(g). La conversión es `bar(a)=bar(g)+1.01325` y `bar(g)=kPa(g)/100`. Así, por ejemplo, 0.80 bar(g) equivale a 1.81 bar(a): sigue estando por encima de la atmósfera. No hay un requisito universal de 2–3 bar(g); la presión resultante depende de la curva, frecuencia, caudal y resistencia de tubería configurados. El cierre de bomba predeterminado es 180 kPa diferenciales (1.8 bar de presión diferencial), ajustable en los parámetros físicos de la interfaz, así que no debe interpretarse como una bomba industrial especificada para 2–3 bar(g). La presión de vapor de suministro conserva kPa absolutos para el cálculo termodinámico. No se usan curvas de fabricante ni Darcy–Weisbach: los parámetros son didácticos, no sirven para dimensionar equipos.

## Controladores

- **Nivel feedback**: PI sobre `hSP−h` con tres estrategias seleccionables. `Descarga` mantiene alimentación y actúa en P-102; `Alimentación` mantiene descarga y actúa en P-101; `Coordinada` aumenta alimentación y reduce descarga ante nivel bajo, y hace lo contrario ante nivel alto. Frecuencias limitadas a 0–60 Hz; caudales resultantes los calcula la hidráulica del proceso. La señal de caudal de alimentación solicitada sigue siendo un límite/disturbio, no la lectura del caudal real.
- **Temperatura feedback**: PI sobre `Tout,SP−Tout`, con acción directa. Cuando la descarga está fría, abre TV-101 (0–100%).
- **Temperatura cascada**: PI maestro sobre `Tout` produce consigna de flujo de vapor (0–0.025 kg/s); PI esclavo compara esa consigna con el flujo medido por el modelo y actúa sobre TV-101.

El PI usa `u=Kp·e+I`; Kp tiene unidades de salida/variable y Ki de salida/(variable·s). La interfaz permite ajustar ganancias y consignas, con la señal manipulada limitada por actuador. Anti-windup por retrocálculo descarga el integrador al saturar. Al entrar en automático se inicializa el integrador para seguir la salida actual; al volver a manual se conserva la apertura/frecuencia vigente.

La comparación feedback/cascada ejecuta dos instancias independientes con el mismo estado inicial, entradas y escalones de alimentación, temperatura de entrada y presión de vapor. Las perturbaciones son cambios respecto al valor base y se aplican en tiempo de simulación; inician desactivadas para que el valor de línea coincida con el comando base hasta que el usuario habilite y aplique los escalones. La temperatura que marca TIT-101 en el P&ID es la lectura instantánea de la corriente; el mando lateral es la temperatura base, por lo que diferirán intencionalmente mientras actúe un escalón habilitado. Las gráficas incluyen SP, PV y señal manipulada y presentan las señales normalizadas en el mismo eje; el panel instantáneo muestra valores con unidades. La velocidad 10×/60× acelera el tiempo simulado, sin cambiar el paso numérico.

## Alcance y limitaciones

72 °C es la consigna de referencia para el ejercicio inspirado en pasteurización, no una validación sanitaria: el modelo no incluye tiempo de retención, distribución térmica ni condiciones microbiológicas. El control puede estabilizar cerca de 72 °C cuando el caudal y el vapor lo permiten; a alto caudal o baja presión puede saturarse la válvula sin alcanzar la consigna. Con flujo detenido, la temperatura retenida en el serpentín puede responder lentamente y no representa un producto en operación continua. El tanque y serpentín son estados concentrados, sin gradientes espaciales ni dinámica detallada de válvula o actuador.

## Guía de ensayos para estudiantes

La interfaz integra una guía desplegable con cuatro prácticas de balances dinámicos, feedback PI y cascada, con maniobras sobre los controles existentes y observaciones esperadas. El documento completo se distribuye como `GUIA_PRACTICAS_CONTROL.txt` (enlace de descarga al inicio de la guía en la aplicación). Las perturbaciones requieren habilitar su casilla y pulsar **Aplicar perturbaciones**; los tiempos corresponden al reloj simulado. Para experimentos comparativos se recomienda reiniciar y conservar condiciones equivalentes. La referencia de 72 °C es académica y no constituye validación sanitaria de pasteurización.
