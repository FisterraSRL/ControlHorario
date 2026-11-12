-- A review uses the identity of a detected irregularity and leaves the evidence intact.
CREATE TABLE [controlhorario].[irregularidades_revisadas] (
  [dni] nvarchar(32) NOT NULL,
  [fecha] date NOT NULL,
  [tipo] nvarchar(16) NOT NULL,
  [estado] nvarchar(16) NOT NULL,
  [nota] nvarchar(500) NOT NULL,
  CONSTRAINT [PK_ch_irregularidades_revisadas] PRIMARY KEY ([dni], [fecha], [tipo]),
  CONSTRAINT [CK_ch_irregularidades_tipo]
    CHECK ([tipo] IN (N'incompleta', N'descanso', N'tardanza')),
  CONSTRAINT [CK_ch_irregularidades_estado]
    CHECK ([estado] IN (N'justificada', N'revisada') AND ([estado] <> N'justificada' OR LEN([nota]) > 0)),
  CONSTRAINT [FK_ch_irregularidades_fichadas]
    FOREIGN KEY ([dni], [fecha]) REFERENCES [controlhorario].[fichadas] ([dni], [fecha])
    ON DELETE CASCADE
);

CREATE INDEX [IX_ch_irregularidades_fecha]
  ON [controlhorario].[irregularidades_revisadas] ([fecha]);
