SISTEMA DE PREFACTURACION INFORMATICA BBVA - V1.14

1. Descomprime toda la carpeta.
2. Abre ABRIR_SISTEMA.bat o index.html con Chrome / Edge.
3. Carga el Excel mensual en valores.
4. Subsana cualquier observacion en POR REVISAR.
5. Genera la prefactura Excel como en las versiones anteriores.

INDICADORES - REVISION TIPO EXCEL
- Incluye dos vistas: TODOS LOS SERVICIOS y FUERA DE PLAZO / POR REVISAR.
- Las guias que siguen fuera de plazo aparecen en el apartado POR REVISAR.
- Si corriges una fecha y queda dentro del plazo, la fila se marca amarilla y sale del apartado al GUARDAR FECHAS.
- La fecha guardada reemplaza a la fecha anterior en la data interna y en la prefactura que se genere despues.
- Colores: verde = cumple, rojo = fuera de plazo, amarillo = modificado y aun no guardado.

SELECCION Y ACCIONES MASIVAS
- Puedes seleccionar una o varias guias.
- SELECCIONAR TODO LO FILTRADO marca todas las filas visibles segun los filtros actuales.
- USAR FECHA DE PLAZO copia a cada guia SU PROPIA fecha de plazo como fecha de entrega.
- APLICAR MISMA FECHA coloca la fecha indicada en todas las guias seleccionadas.
- MARCAR FF coloca FF en todas las guias seleccionadas.
- NEGATIVOS -> 0 cambia manualmente a 0 las alertas negativas de servicios que cumplen, sin modificar sus fechas.

FILTROS
- Busqueda por guia, oficina o codigo.
- Territorio: Local / Nacional.
- Servicio: Entrega / Recojo / Traslado.
- Cumplimiento: Dentro / Fuera / FF.
- Atraso: 1 dia / 2 a 3 dias / 4 dias a mas.
- Puedes ordenar haciendo clic en los encabezados.

CONTADORES
- Servicios totales.
- Servicios que cumplen.
- Servicios por revisar.
- Cumplimiento general, Local y Nacional.

LEAD TIMES
- Valores iniciales:
  ENTREGA: LC 2 / TE 3 / AE 2 dias.
  RECOJO: LC 4 / TE 5 / AE 5 dias.
  TRASLADO: LC 2 / TE 3 / AE 3 dias.
- El calculo considera lunes a sabado como dias habiles y excluye domingos.
- Los feriados / dias no laborables adicionales se administran desde Indicadores.
- Los FF se consideran CUMPLE.

SALIDAS
- Mientras haya fechas modificadas sin guardar, las salidas quedan bloqueadas.
- Generar consolidado: crea un Excel con DATA y RESUMEN.
- Generar revision Tradel: incluye solo los servicios que sigan FUERA DE PLAZO despues de guardar las correcciones.
- Generar indicadores PDF: usa las fechas corregidas y guardadas.

IMPORTANTE
- El sistema funciona como aplicacion web local; no requiere Python.
- Requiere conexion a internet al abrir para cargar los componentes de Excel y PDF.
- Los tarifarios, lead times y feriados se guardan en el navegador local.

CAMBIOS V1.11
- Vista previa de prefactura: filtro directo por GR TRADEL / GR BBVA.
- Indicadores: nuevos filtros de atraso 4-9, 10-15, 15-20 y 21+ dias.
- Revision Tradel Excel: datos centrados; columna L (LEAD TIMEEE) oculta en DATA.
- Se elimina la pestana LEADTIME del Excel de Revision Tradel.
- PDF: tablas corregidas con fondo claro y valores visibles.
- PDF: etiquetas de graficos ajustadas para evitar superposiciones.
- PDF: graficos diarios muestran la cantidad de servicios encima de cada barra.

CAMBIOS V1.12
- Revision Tradel / TABLA: se elimina por completo la columna visible LEADTIME; quedan FECHA DE CIERRE, ALERTA, CUMPLE y MOTIVOS.
- PDF: encabezados de todas las tablas reforzados para que siempre muestren texto y fondo azul.
- PDF: mayor uso del espacio disponible en las diapositivas de cumplimiento.
- PDF: etiquetas de barras separadas y con mayor legibilidad para evitar superposiciones.
- PDF diario: numeros sobre las barras mas grandes.
- PDF diario: cada grafico incluye una tabla compacta de FECHA / SERVICIOS, sin fila de total general.
- PDF diario: paneles de resumen de la derecha reacomodados y ampliados.

V1.14 - Ajustes de revision e indicadores
- Revisión Tradel: se elimina por completo la columna técnica LEAD TIMEEE de la hoja DATA.
- ALERTA se exporta como número/general, no como fecha.
- Motivos de atraso seleccionables desde Indicadores y enviados automáticamente a la Revisión Tradel.
- Pico del mes general calculado con el total diario LOCAL + NACIONAL.
- Ajuste del panel derecho del PDF para evitar textos fuera del recuadro.


CAMBIOS V1.16
- TRASLADO + FF: LC cobra S/ 2.00 de flete + IGV; AE o TE cobra S/ 8.00 de flete + IGV.
- Ya no se bloquea TRASLADO + FF con MINI = NO.
- Los cambios realizados en TARIFAS y MINI quedan guardados en el navegador con una clave estable y una copia de respaldo.
- Si ya tenias cambios guardados en la version anterior, se migran automaticamente al abrir V1.16 en el mismo navegador/origen.
