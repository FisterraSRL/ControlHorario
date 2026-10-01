-- ControlHorario — qué faltas ya fueron notificadas (Azure SQL).
--
-- Una falta no se guarda en ningún lado: se deriva de la fichada en cada lectura, y no tiene
-- id. Lo que sí es un hecho, y no una conclusión que una corrección de reglas deba invalidar,
-- es que RRHH generó una notificación que la cubría. Esta tabla guarda ese hecho con la misma
-- identidad que tiene una falta en pantalla: la persona, el día y la clase de falta.
--
-- GENERAR EL WORD ES LO QUE MARCA LA FALTA COMO NOTIFICADA. No hay marca manual: la pantalla
-- registra las claves que cubre el documento y recién después lo descarga.
--
-- SE CONSERVA LA PRIMERA NOTIFICACIÓN. Volver a generar la misma carta no pisa
-- `notificado_por` ni `notificado_at`: la primera vez que se le notificó a alguien una falta
-- es la que importa ante un reclamo. Cada nueva generación queda igual en `auditoria`.
--
-- UNA FALTA QUE DESAPARECE NO SE BORRA ACÁ. Si una corrección de reglas hace que el día deje
-- de tener esa falta, la fila queda como registro histórico y la pantalla simplemente no la
-- cuenta: el indicador cruza estas filas con las faltas que existen hoy.

CREATE TABLE [controlhorario].[faltas_notificadas] (
  [dni]            nvarchar(32)  NOT NULL,
  [fecha]          date          NOT NULL,
  [tipo]           nvarchar(16)  NOT NULL,
  [notificado_por] nvarchar(320) NOT NULL,
  [notificado_at]  datetime2(3)  NOT NULL
    CONSTRAINT [DF_ch_faltas_notificadas_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_faltas_notificadas] PRIMARY KEY ([dni], [fecha], [tipo]),
  -- Las mismas tres clases que emite el motor (`TipoFalta`). Una clase nueva en el motor
  -- necesita una migración que reemplace este CHECK, igual que el rol en 004.
  CONSTRAINT [CK_ch_faltas_notificadas_tipo]
    CHECK ([tipo] IN (N'incompleta', N'descanso', N'tardanza')),
  -- Mismo razonamiento que `ausencias` y `adjuntos`: una notificación es sobre un día que
  -- existe en la evidencia. Vaciar el historial borra la fichada, y una notificación sobre un
  -- día que ya no existe no se puede mostrar ni cruzar con nada.
  CONSTRAINT [FK_ch_faltas_notificadas_fichadas]
    FOREIGN KEY ([dni], [fecha]) REFERENCES [controlhorario].[fichadas] ([dni], [fecha])
    ON DELETE CASCADE
);

-- La lectura es siempre por ventana de fechas (el período de la pantalla), no por persona.
CREATE INDEX [IX_ch_faltas_notificadas_fecha]
  ON [controlhorario].[faltas_notificadas] ([fecha]);
