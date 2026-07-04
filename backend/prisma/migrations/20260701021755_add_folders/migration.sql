/*
  Warnings:

  - A unique constraint covering the columns `[projectId,path,name]` on the table `File` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "File_projectId_name_key";

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "isFolder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "path" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "File_projectId_path_name_key" ON "File"("projectId", "path", "name");
