
INSERT INTO users VALUES (1,'admin','pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Admin',1);
INSERT INTO users VALUES (2,'user1','pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Foo',2);
INSERT INTO users VALUES (3,'user2','pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Bar',2);
INSERT INTO users VALUES (4,'user3','pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc','Baz',2);

INSERT INTO zone VALUES (1,1,'Zone 1A','zone_maps/zone1a.png');
INSERT INTO zone VALUES (2,1,'Zone 1B','zone_maps/zone1b.png');
INSERT INTO zone VALUES (3,2,'Parking','zone_maps/parking.png');

INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'1.1',22,94,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'1.2',84,85,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'1.3',36,158,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'1.4',97,147,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'2.1',89,282,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'2.2',88,352,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'2.3',152,285,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'2.4',147,357,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'3.1',410,355,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'3.2',410,411,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'3.3',342,411,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'4.1',483,365,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'4.2',548,365,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'4.3',482,422,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'4.4',548,422,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'5.1',687,329,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'5.2',687,386,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'5.3',687,443,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'5.4',757,329,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'5.5',757,386,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'5.6',757,443,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'6.1',870,344,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'6.2',870,401,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'6.3',870,458,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'6.4',940,344,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'6.5',940,401,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (1,'6.6',940,458,true);

INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1A.1',145,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1A.2',145,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1A.3',145,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1A.4',209,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1A.5',209,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1A.6',209,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1B.1',296,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1B.2',296,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1B.3',296,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1B.4',360,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1B.5',360,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'1B.6',360,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'2.1',511,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'2.2',511,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'2.3',511,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'2.4',575,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'2.5',575,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'2.6',575,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3A.1',670,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3A.2',670,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3A.3',670,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3A.4',734,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3A.5',734,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3A.6',734,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3B.1',804,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3B.2',804,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3B.3',804,224,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3B.4',868,114,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3B.5',868,168,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (2,'3B.6',868,224,true);

INSERT INTO seat (zid,name,x,y,enabled) VALUES (3,'P.070',549,190,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (3,'P.036',777,173,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (3,'P.037',769,227,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (3,'P.038',757,300,true);
INSERT INTO seat (zid,name,x,y,enabled) VALUES (3,'P.039',748,358,true);


