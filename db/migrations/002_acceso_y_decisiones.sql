-- ControlHorario — acceso, configuración y atribución de decisiones (Azure SQL).

CREATE TABLE [controlhorario].[usuarios] (
  [id]              bigint         IDENTITY(1,1) NOT NULL,
  [email]           nvarchar(320)  NOT NULL,
  [nombre]          nvarchar(200)  NOT NULL,
  [hash_contrasena] nvarchar(500)  NOT NULL,
  [activo]          bit            NOT NULL CONSTRAINT [DF_ch_usuarios_activo] DEFAULT (1),
  [creado_at]       datetime2(3)   NOT NULL CONSTRAINT [DF_ch_usuarios_creado_at] DEFAULT (SYSUTCDATETIME()),
  [actualizado_at]  datetime2(3)   NOT NULL CONSTRAINT [DF_ch_usuarios_actualizado_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_usuarios] PRIMARY KEY ([id]),
  CONSTRAINT [UQ_ch_usuarios_email] UNIQUE ([email]),
  CONSTRAINT [CK_ch_usuarios_email_normalizado]
    CHECK ([email] = LOWER([email]) AND [email] <> N''),
  CONSTRAINT [CK_ch_usuarios_email_parece_correo]
    CHECK (CHARINDEX(N'@', [email]) > 1),
  CONSTRAINT [CK_ch_usuarios_nombre_no_vacio]
    CHECK (LEN(LTRIM(RTRIM([nombre]))) > 0),
  CONSTRAINT [CK_ch_usuarios_hash_argon2id]
    CHECK ([hash_contrasena] LIKE N'$argon2id$%')
);

CREATE TABLE [controlhorario].[sesiones] (
  [id]         nvarchar(64) NOT NULL,
  [usuario_id] bigint       NOT NULL,
  [creada_at]  datetime2(3) NOT NULL CONSTRAINT [DF_ch_sesiones_creada_at] DEFAULT (SYSUTCDATETIME()),
  [expira_at]  datetime2(3) NOT NULL,
  [ultima_at]  datetime2(3) NOT NULL CONSTRAINT [DF_ch_sesiones_ultima_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_sesiones] PRIMARY KEY ([id]),
  CONSTRAINT [FK_ch_sesiones_usuarios]
    FOREIGN KEY ([usuario_id]) REFERENCES [controlhorario].[usuarios] ([id]) ON DELETE CASCADE,
  CONSTRAINT [CK_ch_sesiones_expira_despues] CHECK ([expira_at] > [creada_at])
);

CREATE INDEX [IX_ch_sesiones_usuario] ON [controlhorario].[sesiones] ([usuario_id]);
CREATE INDEX [IX_ch_sesiones_expira] ON [controlhorario].[sesiones] ([expira_at]);

CREATE TABLE [controlhorario].[configuracion] (
  [clave]           nvarchar(100) NOT NULL,
  [valor]           nvarchar(max) NOT NULL,
  [actualizado_por] nvarchar(320) NULL,
  [actualizado_at]  datetime2(3)  NOT NULL CONSTRAINT [DF_ch_config_actualizado_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_configuracion] PRIMARY KEY ([clave]),
  CONSTRAINT [CK_ch_config_valor_json] CHECK (ISJSON([valor], SCALAR) = 1)
);

INSERT INTO [controlhorario].[configuracion] ([clave], [valor]) VALUES
  (N'descanso_max_min', N'30'),
  (N'tolerancia_min', N'0'),
  (N'horas_turno_semanales', N'51');

CREATE TABLE [controlhorario].[sector_reglas] (
  [sector]              nvarchar(200) NOT NULL,
  [fichadas_requeridas] int           NOT NULL,
  [actualizado_por]     nvarchar(320) NULL,
  [actualizado_at]      datetime2(3)  NOT NULL CONSTRAINT [DF_ch_sector_reglas_actualizado_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_sector_reglas] PRIMARY KEY ([sector]),
  CONSTRAINT [CK_ch_sector_reglas_valor] CHECK ([fichadas_requeridas] IN (2, 4)),
  CONSTRAINT [CK_ch_sector_reglas_sector] CHECK (LEN(LTRIM(RTRIM([sector]))) > 0)
);

INSERT INTO [controlhorario].[sector_reglas] ([sector], [fichadas_requeridas]) VALUES
  (N'Reparto', 2),
  (N'Cocina', 2),
  (N'Administración', 2);

CREATE TABLE [controlhorario].[exclusiones_semilla] (
  [dni]         nvarchar(32) NOT NULL,
  [aplicada_at] datetime2(3) NOT NULL CONSTRAINT [DF_ch_exclusiones_semilla_at] DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT [PK_ch_exclusiones_semilla] PRIMARY KEY ([dni])
);

ALTER TABLE [controlhorario].[exclusiones]
  ADD [creado_por] nvarchar(320) NULL;

ALTER TABLE [controlhorario].[adjuntos]
  ADD [tipo_mime] nvarchar(100) NULL,
      [subido_por] nvarchar(320) NULL;
