-- Durable letter snapshots have no FK to imported evidence: history survives replacement.
CREATE TABLE [controlhorario].[envios_mutex] (
  [id] int NOT NULL CONSTRAINT [PK_ch_envios_mutex] PRIMARY KEY,
  CONSTRAINT [CK_ch_envios_mutex] CHECK ([id] = 1)
);
INSERT INTO [controlhorario].[envios_mutex] ([id]) VALUES (1);

CREATE TABLE [controlhorario].[emisiones] (
  [id] nvarchar(36) NOT NULL CONSTRAINT [PK_ch_emisiones] PRIMARY KEY,
  [documentos] nvarchar(max) NOT NULL,
  [fecha_documento] date NOT NULL,
  [emitido_at] datetime2(3) NOT NULL CONSTRAINT [DF_ch_emisiones_at] DEFAULT SYSUTCDATETIME(),
  [actor] nvarchar(320) NOT NULL,
  CONSTRAINT [CK_ch_emisiones_json] CHECK (ISJSON([documentos]) = 1)
);
CREATE TABLE [controlhorario].[documentos_notificacion] (
  [id] nvarchar(36) NOT NULL CONSTRAINT [PK_ch_documentos_notificacion] PRIMARY KEY,
  [snapshot] nvarchar(max) NOT NULL,
  [creado_at] datetime2(3) NOT NULL CONSTRAINT [DF_ch_documentos_at] DEFAULT SYSUTCDATETIME(),
  [creado_por] nvarchar(320) NOT NULL,
  [emision_id] nvarchar(36) NULL,
  [descartado_at] datetime2(3) NULL,
  CONSTRAINT [CK_ch_documentos_snapshot] CHECK (ISJSON([snapshot]) = 1),
  CONSTRAINT [FK_ch_documentos_emision] FOREIGN KEY ([emision_id]) REFERENCES [controlhorario].[emisiones] ([id]),
  CONSTRAINT [CK_ch_documentos_estado] CHECK ([emision_id] IS NULL OR [descartado_at] IS NULL)
);
CREATE INDEX [IX_ch_documentos_estado] ON [controlhorario].[documentos_notificacion] ([emision_id], [descartado_at], [creado_at]);
ALTER TABLE [controlhorario].[faltas_notificadas] ADD [version] nvarchar(36) NOT NULL
  CONSTRAINT [DF_ch_notificadas_version] DEFAULT (CONVERT(nvarchar(36), NEWID())) WITH VALUES;
ALTER TABLE [controlhorario].[faltas_notificadas] ADD [documento_id] nvarchar(36) NULL;
ALTER TABLE [controlhorario].[faltas_notificadas] ADD CONSTRAINT [FK_ch_notificadas_documento]
  FOREIGN KEY ([documento_id]) REFERENCES [controlhorario].[documentos_notificacion] ([id]);
