# Library: giving the owner files

`lilbot_give_file(path, title, requestId)` delivers a finished file from your folder to the owner's Library (at most 50 MiB, a regular file inside your folder). Give each file with a new requestId. Working files are not delivered automatically. Kinds: media (image, audio, video), page (.md, .html) and file. The Library lists items newest first; it points at your file, so do not move or delete it afterwards.
