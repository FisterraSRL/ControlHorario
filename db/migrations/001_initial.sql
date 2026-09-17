-- ControlHorario — modelo funcional inicial para Azure SQL Database.
--
-- La base se comparte con Centraliza y FSTrack. Todos los objetos de este proyecto viven
-- en el esquema [controlhorario], siempre se referencian con nombre calificado y no poseen
-- ninguna relación con objetos de [dbo] ni de otros esquemas.

CREATE TABLE [controlhorario].[empleados] (
  [dni]     nvarchar(32)  NOT NULL,
  [nombre]  nvarchar(200) NOT NULL,
  [legajo]  nvarchar(80)  NULL,
  [sector]  nvarchar(200) NULL,
  [activo]  bit           NOT NULL CONSTRAINT [DF_ch_empleados_activo] DEFAULT (1),
  CONSTRAINT [PK_ch_empleados] PRIMARY KEY ([dni])
);

CREATE INDEX [IX_ch_empleados_sector]
  ON [controlhorario].[empleados] ([sector]) WHERE [activo] = 1;

CREATE TABLE [controlhorario].[cargas] (
  [id]         bigint        IDENTITY(1,1) NOT NULL,
  [archivo]    nvarchar(260) NOT NULL,
  [subido_por] nvarchar(320) NOT NULL,
  [subido_at]  datetime2(3)  NOT NULL CONSTRAINT [DF_ch_cargas_subido_at] DEFAULT (SYSUTCDATETIME()),
  [filas]      int           NOT NULL CONSTRAINT [DF_ch_cargas_filas] DEFAULT (0),
  CONSTRAINT [PK_ch_cargas] PRIMARY KEY ([id]),
  CONSTRAINT [CK_ch_cargas_filas] CHECK ([filas] >= 0)
);

-- La fila QUICKPASS original se conserva como JSON. Las irregularidades se derivan al
-- leer; no se persisten conclusiones que una corrección futura de reglas deba invalidar.
CREATE TABLE [controlhorario].[fichadas] (
  [dni]      nvarchar(32) NOT NULL,
  [fecha]    date         NOT NULL,
  [payload]  nvarchar(max) NOT NULL,
  [carga_id] bigint       NOT NULL,
  CONSTRAINT [PK_ch_fichadas] PRIMARY KEY ([dni], [fecha]),
  CONSTRAINT [CK_ch_fichadas_payload_json] CHECK (ISJSON([payload]) = 1),
  CONSTRAINT [FK_ch_fichadas_cargas]
    FOREIGN KEY ([carga_id]) REFERENCES [controlhorario].[cargas] ([id])
);

CREATE INDEX [IX_ch_fichadas_fecha] ON [controlhorario].[fichadas] ([fecha]);
CREATE INDEX [IX_ch_fichadas_carga] ON [controlhorario].[fichadas] ([carga_id]);

CREATE TABLE [controlhorario].[motivos] (
  [id]     int           NOT NULL,
  [label]  nvarchar(120) NOT NULL,
  [worked] bit           NOT NULL,
  [activo] bit           NOT NULL CONSTRAINT [DF_ch_motivos_activo] DEFAULT (1),
  CONSTRAINT [PK_ch_motivos] PRIMARY KEY ([id]),
  CONSTRAINT [UQ_ch_motivos_label] UNIQUE ([label])
);

INSERT INTO [controlhorario].[motivos] ([id], [label], [worked]) VALUES
  (1, N'Ausente sin Aviso',  0),
  (2, N'Ausente con Aviso',  0),
  (3, N'Suspensión',         0),
  (4, N'Enfermedad',         1),
  (5, N'Feriado',            1),
  (6, N'Autorizado empresa', 1),
  (7, N'Vacaciones',         1),
  (8, N'Olvidó fichar',      1),
  (9, N'Recupera Horas',     0);

CREATE TABLE [controlhorario].[ausencias] (
  [dni]           nvarchar(32)  NOT NULL,
  [fecha]         date          NOT NULL,
  [motivo_id]     int           NULL,
  [motivo_source] nvarchar(16)  NULL,
  [resuelto_por]  nvarchar(320) NULL,
  [resuelto_at]   datetime2(3)  NULL,
  CONSTRAINT [PK_ch_ausencias] PRIMARY KEY ([dni], [fecha]),
  CONSTRAINT [FK_ch_ausencias_fichadas]
    FOREIGN KEY ([dni], [fecha]) REFERENCES [controlhorario].[fichadas] ([dni], [fecha])
    ON DELETE CASCADE,
  CONSTRAINT [FK_ch_ausencias_motivos]
    FOREIGN KEY ([motivo_id]) REFERENCES [controlhorario].[motivos] ([id]),
  CONSTRAINT [CK_ch_ausencias_source]
    CHECK ([motivo_source] IS NULL OR [motivo_source] IN (N'partes', N'manual', N'encargado')),
  CONSTRAINT [CK_ch_ausencias_motivo_origen]
    CHECK (([motivo_id] IS NULL AND [motivo_source] IS NULL) OR
           ([motivo_id] IS NOT NULL AND [motivo_source] IS NOT NULL)),
  CONSTRAINT [CK_ch_ausencias_manual_atribuible]
    CHECK ([motivo_source] <> N'manual' OR
           ([resuelto_por] IS NOT NULL AND [resuelto_at] IS NOT NULL))
);

CREATE INDEX [IX_ch_ausencias_pendientes]
  ON [controlhorario].[ausencias] ([fecha]) WHERE [motivo_id] IS NULL;
CREATE INDEX [IX_ch_ausencias_motivo] ON [controlhorario].[ausencias] ([motivo_id]);

CREATE TABLE [controlhorario].[adjuntos] (
  [id]        bigint         IDENTITY(1,1) NOT NULL,
  [dni]       nvarchar(32)   NOT NULL,
  [fecha]     date           NOT NULL,
  [blob_path] nvarchar(500)  NOT NULL,
  [nombre]    nvarchar(260)  NOT NULL,
  [bytes]     bigint         NOT NULL,
  [subido_at] datetime2(3)   NOT NULL CONSTRAINT [DF_ch_adjuntos_subido_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_adjuntos] PRIMARY KEY ([id]),
  CONSTRAINT [UQ_ch_adjuntos_blob_path] UNIQUE ([blob_path]),
  CONSTRAINT [CK_ch_adjuntos_bytes] CHECK ([bytes] >= 0),
  CONSTRAINT [FK_ch_adjuntos_fichadas]
    FOREIGN KEY ([dni], [fecha]) REFERENCES [controlhorario].[fichadas] ([dni], [fecha])
    ON DELETE CASCADE
);

CREATE INDEX [IX_ch_adjuntos_dia] ON [controlhorario].[adjuntos] ([dni], [fecha]);

CREATE TABLE [controlhorario].[exclusiones] (
  [dni]          nvarchar(32)  NOT NULL,
  [motivo_texto] nvarchar(500) NULL,
  [creado_at]    datetime2(3)  NOT NULL CONSTRAINT [DF_ch_exclusiones_creado_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_exclusiones] PRIMARY KEY ([dni])
);

CREATE TABLE [controlhorario].[auditoria] (
  [id]         bigint         IDENTITY(1,1) NOT NULL,
  [actor]      nvarchar(320)  NOT NULL,
  [accion]     nvarchar(100)  NOT NULL,
  [entidad]    nvarchar(100)  NOT NULL,
  [entidad_id] nvarchar(200)  NULL,
  [datos]      nvarchar(max)  NULL,
  [at]         datetime2(3)   NOT NULL CONSTRAINT [DF_ch_auditoria_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_auditoria] PRIMARY KEY ([id]),
  CONSTRAINT [CK_ch_auditoria_datos_json] CHECK ([datos] IS NULL OR ISJSON([datos]) = 1)
);

CREATE INDEX [IX_ch_auditoria_entidad]
  ON [controlhorario].[auditoria] ([entidad], [entidad_id], [at] DESC);
CREATE INDEX [IX_ch_auditoria_at] ON [controlhorario].[auditoria] ([at] DESC);
