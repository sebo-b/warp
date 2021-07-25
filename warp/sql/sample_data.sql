
INSERT INTO user VALUES (5,"root",'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Superadmin',0);
INSERT INTO user VALUES (1,"admin",'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Admin',1);
INSERT INTO user VALUES (2,"user1",'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','User 1',2);
INSERT INTO user VALUES (3,"user2",'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','User 2',2);
INSERT INTO user VALUES (4,"viewer",'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Viewer',2);

INSERT INTO zone VALUES (1,'Test Zone 1','zone_maps/zone1.png');
INSERT INTO zone VALUES (2,'Test Zone 2','zone_maps/zone2.png');

INSERT INTO seat VALUES (1,1,'Seat A1',20,20);
INSERT INTO seat VALUES (2,1,'Seat A2',100,20);
INSERT INTO seat VALUES (3,1,'Seat A3',20,100);
INSERT INTO seat VALUES (4,1,'Seat A4',100,100);

INSERT INTO seat VALUES (5,2,'Seat B1',120,120);
INSERT INTO seat VALUES (6,2,'Seat B2',200,120);
INSERT INTO seat VALUES (7,2,'Seat B3',120,200);
INSERT INTO seat VALUES (8,2,'Seat B4',200,200);

INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (1,1,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','60 minutes'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','90 minutes'),"comm1");
INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (2,1,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','120 minutes'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','180 minutes'),"comm1");
INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (2,2,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','2 day','75 minutes'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','2 day','105 minutes'),"comm2");
INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (1,3,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','105 minutes'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','120 minutes'),"comm1");
INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (3,6,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','30 minutes'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','75 minutes'),"comm4");
INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (1,3,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','3 hours'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','3 hours','30 minutes'),"comm1");
INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (2,8,strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','180 minutes'),
                                                           strftime("%s",strftime("%s",'now','localtime') - strftime("%s",'now','localtime') % 86400,'unixepoch','1 day','210 minutes'),"comm6");


