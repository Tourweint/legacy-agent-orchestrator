FROM maven:3.9-eclipse-temurin-17-alpine AS builder
WORKDIR /build
# 先拷贝 pom，利用缓存！不改动依赖就不会重下
COPY pom.xml .
RUN mvn dependency:go-offline -DskipTests
# 再拷贝代码打包
COPY . .
RUN mvn clean package -DskipTests

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

COPY --from=builder /build/target/*.jar app.jar
EXPOSE 8080

ENTRYPOINT ["java","-jar","app.jar"]