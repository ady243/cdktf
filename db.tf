resource "aws_db_instance" "default" {
  allocated_storage    = 10
  db_name              = "adymasivi"
  port                 = "5433"
  engine               = "postgres"
  engine_version       = "13"
  instance_class       = "db.t3.micro"
  username             = "postgres"
  password             = "postgres"
  parameter_group_name = "default.postgres13"
  skip_final_snapshot  = true

  db_subnet_group_name = "my-database-subnet-group"

  vpc_security_group_ids = [
    "sg-0123456789abcdef",
    "sg-abcdef0123456789"
  ]

  tags = {
    Name = "mydb"
  }
}
