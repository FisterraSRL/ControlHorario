-- ControlHorario — el rol `encargado` y los sectores que supervisa (Azure SQL).
--
-- Un encargado es una cuenta que sólo ve su parte del historial: las fichadas, las ausencias
-- y los adjuntos de los sectores que tiene asignados, y nada más. El sector no es una columna
-- de ninguna tabla propia: vive dentro del JSON QUICKPASS, en
-- `JSON_VALUE([controlhorario].[fichadas].[payload], '$.Sector')`. Por eso el alcance se
-- guarda acá como texto y se compara contra ese valor al leer.
--
-- UN ENCARGADO SUPERVISA UNO O MÁS SECTORES, de ahí la tabla de cruce en lugar de una
-- columna `sector` en `usuarios`.
--
-- LA INVARIANTE «encargado tiene >= 1 sector, el resto tiene 0» NO SE PUEDE ESCRIBIR COMO
-- CHECK. Un CHECK sólo ve la fila de su propia tabla, y esta regla cruza `usuarios` con
-- `usuarios_sectores`: la mitad del dato está en cada lado. Un trigger la expresaría, al
-- precio de una regla de negocio escrita en T-SQL y en TypeScript a la vez. Se decide en la
-- API: `POST /api/admin/usuarios` valida rol y sectores antes de escribir, e inserta el
-- usuario y sus sectores dentro de una única transacción, de modo que nunca queda un
-- encargado sin sectores ni un operador con ellos.

-- El CHECK del rol se reemplaza entero: no hay forma de ampliar la lista de valores
-- permitidos sin volver a crearlo.
ALTER TABLE [controlhorario].[usuarios] DROP CONSTRAINT [CK_ch_usuarios_rol];

-- `sp_executesql` por el mismo motivo que en 003: el lote completo se compila antes de
-- ejecutarse, y agregar una restricción con el nombre que todavía figura en el catálogo al
-- compilar es pedirle al motor que resuelva dos versiones del mismo objeto en un solo paso.
-- Adentro de `sp_executesql` el DROP de arriba ya ocurrió.
EXEC sp_executesql N'
  ALTER TABLE [controlhorario].[usuarios]
    ADD CONSTRAINT [CK_ch_usuarios_rol]
      CHECK ([rol] IN (N''admin'', N''operador'', N''encargado''));
';

CREATE TABLE [controlhorario].[usuarios_sectores] (
  [usuario_id] bigint        NOT NULL,
  [sector]     nvarchar(200) NOT NULL,
  CONSTRAINT [PK_ch_usuarios_sectores] PRIMARY KEY ([usuario_id], [sector]),
  -- Borrar la cuenta borra su alcance. Un sector huérfano no es un dato que sirva a nadie y
  -- sí es una fila que una cuenta nueva con el mismo id heredaría.
  CONSTRAINT [FK_ch_usuarios_sectores_usuarios]
    FOREIGN KEY ([usuario_id]) REFERENCES [controlhorario].[usuarios] ([id]) ON DELETE CASCADE,
  CONSTRAINT [CK_ch_usuarios_sectores_sector] CHECK (LEN(LTRIM(RTRIM([sector]))) > 0)
);

-- NO HAY CLAVE FORÁNEA HACIA [sector_reglas], Y ES DELIBERADO. Esa tabla no es el catálogo
-- de sectores: sólo guarda los sectores que tienen una regla explícita de fichadas
-- requeridas. Los sectores reales son los que aparecen en la planilla QUICKPASS, y son
-- muchos más. Una FK contra `sector_reglas` haría imposible asignarle a un encargado un
-- sector que existe en la planilla pero todavía no tiene regla propia.
CREATE INDEX [IX_ch_usuarios_sectores_sector]
  ON [controlhorario].[usuarios_sectores] ([sector]);
