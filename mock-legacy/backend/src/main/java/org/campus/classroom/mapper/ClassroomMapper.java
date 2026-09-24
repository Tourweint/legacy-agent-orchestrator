package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.*;
import org.campus.classroom.entity.Classroom;

import java.util.Collection;
import java.util.List;

@Mapper
public interface ClassroomMapper {

    @Insert("insert into classroom (room_number, building,seat_rows, seat_cols, status, remark) values (#{roomNumber}, #{building},#{seatRows}, #{seatCols}, #{status}, #{remark})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Classroom classroom);

    @Select("select * from classroom where id = #{id}")
    @Results(id = "classroomResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "room_number", property = "roomNumber"),
            @Result(column = "building", property = "building"),
            @Result(column = "seat_rows", property = "seatRows"),
            @Result(column = "seat_cols", property = "seatCols"),
            @Result(column = "status", property = "status"),
            @Result(column = "remark", property = "remark")
    })
    Classroom selectById(Long id);


    @Select("select * from classroom where id = #{id} for update")
    @ResultMap("classroomResultMap")
    Classroom selectByIdForUpdate(Long id);


    @Select("""
        <script>
            select * from classroom where id in
            <foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach>
        </script>
        """)
    @ResultMap("classroomResultMap")
    List<Classroom> selectByIds(@Param("ids") Collection<Long> ids);

    @Select("select * from classroom order by building asc, room_number asc")
    @ResultMap("classroomResultMap")
    List<Classroom> selectAll();

    @Select("select distinct building from classroom where building is not null and trim(building) <> '' order by building asc")
    List<String> selectDistinctBuildings();

    @Select("select * from classroom where building = #{building} and seat_rows*seat_cols >= #{min_capacity} and status = #{status}")
    @ResultMap("classroomResultMap")
    List<Classroom> selectList(@Param("building") String building, @Param("min_capacity") Integer minCapacity, @Param("status") String status);

    @Select("select * from classroom where building=#{building} and room_number=#{room_number}")
    @ResultMap("classroomResultMap")
    Classroom selectByBuildingAndNumber(@Param("building") String building, @Param("room_number") String roomNumber);

    @Update("""
            update classroom
            set room_number = #{roomNumber},
                building = #{building},
                seat_rows = #{seatRows},
                seat_cols = #{seatCols},
                status = #{status},
                remark = #{remark}
            where id = #{id}
            """)
    int updateById(Classroom classroom);

    @Delete("delete from classroom where id = #{id}")
    int deleteById(Long id);
}
