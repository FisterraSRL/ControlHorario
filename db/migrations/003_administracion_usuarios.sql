-- Roles for the user administration panel. Existing installations promote the oldest
-- account, which is the bootstrap RRHH account, and new accounts default to operator.
ALTER TABLE [controlhorario].[usuarios] ADD [rol] nvarchar(16) NULL;

EXEC sp_executesql N'
  UPDATE [controlhorario].[usuarios] SET [rol] = N''operador'' WHERE [rol] IS NULL;

  ;WITH [primer_usuario] AS (
    SELECT TOP (1) [id] FROM [controlhorario].[usuarios] ORDER BY [id]
  )
  UPDATE u SET [rol] = N''admin''
    FROM [controlhorario].[usuarios] u
    JOIN [primer_usuario] p ON p.[id] = u.[id];

  ALTER TABLE [controlhorario].[usuarios] ALTER COLUMN [rol] nvarchar(16) NOT NULL;
  ALTER TABLE [controlhorario].[usuarios]
    ADD CONSTRAINT [DF_ch_usuarios_rol] DEFAULT (N''operador'') FOR [rol];
  ALTER TABLE [controlhorario].[usuarios]
    ADD CONSTRAINT [CK_ch_usuarios_rol] CHECK ([rol] IN (N''admin'', N''operador''));
  CREATE INDEX [IX_ch_usuarios_rol_activo]
    ON [controlhorario].[usuarios] ([rol], [activo]);
';
